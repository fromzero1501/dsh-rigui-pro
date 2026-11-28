// 在不在电脑前：每 N 秒吐一行 JSON，告诉宿主「距离上一次输入过了多久」。
// 只调 GetLastInputInfo 拿时间戳，不挂键盘钩子、不读按键内容、不碰窗口标题。
//
// 用法：
//   idlewatch.exe -every 30 -parent 12345
//   idlewatch.exe -once
//
// 父进程没了就自己退（两条保险：父进程探活 + stdin 断开），不会留孤儿进程。
package main

import (
	"bufio"
	"flag"
	"fmt"
	"os"
	"syscall"
	"time"
	"unsafe"
)

var (
	user32           = syscall.NewLazyDLL("user32.dll")
	procGetLastInput = user32.NewProc("GetLastInputInfo")
	kernel32         = syscall.NewLazyDLL("kernel32.dll")
	procGetTickCount = kernel32.NewProc("GetTickCount")
	procOpenProcess  = kernel32.NewProc("OpenProcess")
	procCloseHandle  = kernel32.NewProc("CloseHandle")
)

type lastInputInfo struct {
	cbSize uint32
	dwTime uint32
}

// 距离上一次键鼠输入过了多少毫秒
func idleMs() uint32 {
	li := lastInputInfo{cbSize: uint32(unsafe.Sizeof(lastInputInfo{}))}
	procGetLastInput.Call(uintptr(unsafe.Pointer(&li)))
	t, _, _ := procGetTickCount.Call()
	return uint32(t) - li.dwTime
}

const processQueryLimitedInformation = 0x1000

func alive(pid int) bool {
	h, _, _ := procOpenProcess.Call(processQueryLimitedInformation, 0, uintptr(pid))
	if h == 0 {
		return false
	}
	procCloseHandle.Call(h)
	return true
}

func emit() {
	fmt.Printf("{\"t\":%d,\"idle\":%d}\n", time.Now().UnixMilli(), idleMs())
}

func main() {
	every := flag.Int("every", 30, "采样间隔（秒）")
	parent := flag.Int("parent", 0, "父进程 pid，0 表示不探活")
	once := flag.Bool("once", false, "只采样一次就退出")
	flag.Parse()

	if *once {
		emit()
		return
	}
	if *every < 5 {
		*every = 5
	}

	// 宿主把 stdin 管道连过来；宿主一死管道就断，读到 EOF 立刻退出
	go func() {
		r := bufio.NewReader(os.Stdin)
		buf := make([]byte, 64)
		for {
			if _, err := r.Read(buf); err != nil {
				os.Exit(0)
			}
		}
	}()

	for {
		emit()
		if *parent > 0 && !alive(*parent) {
			return
		}
		time.Sleep(time.Duration(*every) * time.Second)
	}
}
