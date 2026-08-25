package main

/*
#include <stdlib.h>
*/
import "C"

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"net"
	"net/netip"
	"strconv"
	"strings"
	"sync"
	"time"
	"unsafe"

	"tailscale.com/tsnet"
)

const startupTimeout = 60 * time.Second

type status struct {
	State       string `json:"state"`
	BaseURL     string `json:"baseUrl,omitempty"`
	Hostname    string `json:"hostname,omitempty"`
	TailnetIPv4 string `json:"tailnetIPv4,omitempty"`
	TailnetIPv6 string `json:"tailnetIPv6,omitempty"`
	RemoteHost  string `json:"remoteHost,omitempty"`
	RemotePort  int    `json:"remotePort,omitempty"`
	Auth        auth   `json:"auth,omitempty"`
	Error       string `json:"error,omitempty"`
}

type auth struct {
	Mode             string `json:"mode"`
	Provided         bool   `json:"provided"`
	InteractiveLogin bool   `json:"interactiveLogin"`
}

type instance struct {
	server   *tsnet.Server
	listener net.Listener
	done     chan struct{}
}

var state = struct {
	sync.Mutex
	instance *instance
	status   status
}{status: status{State: "stopped"}}

//export TailscaleStart
func TailscaleStart(stateDir, hostname, authKey, remoteHost *C.char, remotePort C.int) *C.char {
	result := start(
		C.GoString(stateDir),
		C.GoString(hostname),
		C.GoString(authKey),
		C.GoString(remoteHost),
		int(remotePort),
	)
	return resultJSON(result)
}

//export TailscaleStop
func TailscaleStop() *C.char {
	state.Lock()
	stopLocked()
	result := state.status
	state.Unlock()
	return resultJSON(result)
}

//export TailscaleStatus
func TailscaleStatus() *C.char {
	state.Lock()
	result := state.status
	state.Unlock()
	return resultJSON(result)
}

//export TailscaleFree
func TailscaleFree(value *C.char) {
	C.free(unsafe.Pointer(value))
}

func start(stateDir, hostname, authKey, remoteHost string, remotePort int) status {
	state.Lock()
	defer state.Unlock()

	if authKey == "" {
		return setErrorLocked(errors.New("an auth key is required; interactive login is disabled"))
	}
	if stateDir == "" || hostname == "" || remoteHost == "" || remotePort < 1 || remotePort > 65535 {
		return setErrorLocked(errors.New("invalid Tailscale proxy configuration"))
	}

	stopLocked()
	state.status = status{State: "starting", Hostname: hostname, RemoteHost: remoteHost, RemotePort: remotePort, Auth: auth{Mode: "auth_key", Provided: true, InteractiveLogin: false}}

	server := &tsnet.Server{
		Dir:      stateDir,
		Hostname: hostname,
		AuthKey:  authKey,
		// Do not allow tsnet to expose an auth URL or emit diagnostic output
		// through the Android process logs. In particular, never log authKey.
		Logf:     func(string, ...any) {},
		UserLogf: func(string, ...any) {},
	}
	if err := server.Start(); err != nil {
		return setErrorLocked(err, authKey)
	}

	ctx, cancel := context.WithTimeout(context.Background(), startupTimeout)
	_, err := server.Up(ctx)
	cancel()
	if err != nil {
		_ = server.Close()
		return setErrorLocked(err, authKey)
	}

	listener, err := net.Listen("tcp4", "127.0.0.1:0")
	if err != nil {
		_ = server.Close()
		return setErrorLocked(err, authKey)
	}

	current := &instance{server: server, listener: listener, done: make(chan struct{})}
	state.instance = current
	go serve(current, remoteHost, remotePort)
	ip4, ip6 := server.TailscaleIPs()
	state.status = status{
		State:       "ready",
		BaseURL:     "http://" + listener.Addr().String(),
		Hostname:    hostname,
		TailnetIPv4: addrString(ip4),
		TailnetIPv6: addrString(ip6),
		RemoteHost:  remoteHost,
		RemotePort:  remotePort,
		Auth:        auth{Mode: "auth_key", Provided: true, InteractiveLogin: false},
	}
	return state.status
}

func serve(current *instance, remoteHost string, remotePort int) {
	defer close(current.done)
	for {
		local, err := current.listener.Accept()
		if err != nil {
			return
		}
		go proxy(current.server, local, net.JoinHostPort(remoteHost, stringPort(remotePort)))
	}
}

func proxy(server *tsnet.Server, local net.Conn, remote string) {
	defer local.Close()
	ctx, cancel := context.WithTimeout(context.Background(), startupTimeout)
	remoteConn, err := server.Dial(ctx, "tcp", remote)
	cancel()
	if err != nil {
		return
	}
	defer remoteConn.Close()

	done := make(chan struct{})
	go func() {
		_, _ = io.Copy(remoteConn, local)
		_ = remoteConn.Close()
		close(done)
	}()
	_, _ = io.Copy(local, remoteConn)
	_ = local.Close()
	<-done
}

func stopLocked() {
	current := state.instance
	if current != nil {
		_ = current.listener.Close()
		<-current.done
		_ = current.server.Close()
		state.instance = nil
	}
	state.status = status{State: "stopped"}
}

func setErrorLocked(err error, secret ...string) status {
	message := err.Error()
	for _, value := range secret {
		message = strings.ReplaceAll(message, value, "[redacted]")
	}
	state.status = status{State: "error", Error: sanitizeError(message)}
	return state.status
}

func resultJSON(result status) *C.char {
	encoded, err := json.Marshal(result)
	if err != nil {
		return C.CString(`{"state":"error","error":"Unable to encode native status"}`)
	}
	return C.CString(string(encoded))
}

func addrString(addr netip.Addr) string {
	if !addr.IsValid() {
		return ""
	}
	return addr.String()
}

func stringPort(port int) string {
	return strconv.Itoa(port)
}

func sanitizeError(message string) string {
	return strings.ReplaceAll(message, "\n", " ")
}

func main() {}
