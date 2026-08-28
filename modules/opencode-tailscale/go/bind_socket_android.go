//go:build android

package main

/*
#include <dlfcn.h>
#include <errno.h>

static int bindSocket(int fd) {
	typedef int (*bindSocketFunc)(int);
	static bindSocketFunc function;
	static int lookedUp;
	if (!lookedUp) {
		function = (bindSocketFunc)dlsym(RTLD_DEFAULT, "TailscaleBindSocket");
		lookedUp = 1;
	}
	if (!function) return ENOSYS;
	return function(fd);
}
*/
import "C"

import "fmt"

func bindAndroidSocket(fd int) error {
	if err := C.bindSocket(C.int(fd)); err != 0 {
		return fmt.Errorf("Network.bindSocket(%d): errno=%d", fd, int(err))
	}
	return nil
}
