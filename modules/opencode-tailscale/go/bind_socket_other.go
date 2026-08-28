//go:build !android

package main

func bindAndroidSocket(fd int) error { return nil }
