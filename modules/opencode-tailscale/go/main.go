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
	"os"
	"runtime"
	"strconv"
	"strings"
	"sync"
	"time"
	"unsafe"

	"tailscale.com/client/local"
	"tailscale.com/ipn"
	"tailscale.com/net/netmon"
	"tailscale.com/tsnet"
)

const startupTimeout = 60 * time.Second

type status struct {
	State               string `json:"state"`
	BaseURL             string `json:"baseUrl,omitempty"`
	Hostname            string `json:"hostname,omitempty"`
	TailnetIPv4         string `json:"tailnetIPv4,omitempty"`
	TailnetIPv6         string `json:"tailnetIPv6,omitempty"`
	RemoteHost          string `json:"remoteHost,omitempty"`
	RemotePort          int    `json:"remotePort,omitempty"`
	LoginURL            string `json:"loginUrl,omitempty"`
	Auth                auth   `json:"auth,omitempty"`
	Phase               string `json:"phase,omitempty"`
	NetworkAvailable    bool   `json:"networkAvailable"`
	NetworkType         string `json:"networkType,omitempty"`
	LastNetworkChangeAt int64  `json:"lastNetworkChangeAt,omitempty"`
	ControlPlaneOnline  bool   `json:"controlPlaneOnline"`
	TailnetOnline       bool   `json:"tailnetOnline"`
	DiagnosticCode      string `json:"diagnosticCode,omitempty"`
	DiagnosticMessage   string `json:"diagnosticMessage,omitempty"`
	Error               string `json:"error,omitempty"`
}

type auth struct {
	Mode             string `json:"mode"`
	InteractiveLogin bool   `json:"interactiveLogin"`
}

type instance struct {
	server   *tsnet.Server
	listener net.Listener
	done     chan struct{}
}

type androidInterface struct {
	Name      string   `json:"name"`
	Index     int      `json:"index"`
	Addresses []string `json:"addresses"`
}

var state = struct {
	sync.Mutex
	instance *instance
	status   status
}{status: status{State: "stopped"}}

var interfaces = struct {
	sync.RWMutex
	values []netmon.Interface
}{}

//export TailscaleStart
func TailscaleStart(stateDir, hostname, remoteHost *C.char, remotePort C.int) *C.char {
	result := start(
		C.GoString(stateDir),
		C.GoString(hostname),
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

//export TailscaleNetworkChanged
func TailscaleNetworkChanged(available C.int, networkType *C.char, at C.longlong) {
	state.Lock()
	state.status.NetworkAvailable = available != 0
	state.status.NetworkType = C.GoString(networkType)
	state.status.LastNetworkChangeAt = int64(at)
	if !state.status.NetworkAvailable && state.status.State != "stopped" {
		state.status.Phase = "network_unavailable"
		state.status.DiagnosticCode = "network_unavailable"
		state.status.DiagnosticMessage = "Android reports no active network"
	}
	state.Unlock()
}

//export TailscaleSetInterfaces
func TailscaleSetInterfaces(value *C.char) {
	var android []androidInterface
	if err := json.Unmarshal([]byte(C.GoString(value)), &android); err != nil {
		return
	}
	values := make([]netmon.Interface, 0, len(android))
	for _, item := range android {
		if item.Name == "" || item.Index < 1 {
			continue
		}
		addrs := make([]net.Addr, 0, len(item.Addresses))
		for _, value := range item.Addresses {
			ip, network, err := net.ParseCIDR(value)
			if err == nil {
				network.IP = ip
				addrs = append(addrs, network)
			}
		}
		values = append(values, netmon.Interface{
			Interface: &net.Interface{Name: item.Name, Index: item.Index, Flags: net.FlagUp},
			AltAddrs:  addrs,
		})
	}
	interfaces.Lock()
	interfaces.values = values
	interfaces.Unlock()
}

//export TailscaleFree
func TailscaleFree(value *C.char) {
	C.free(unsafe.Pointer(value))
}

func start(stateDir, hostname, remoteHost string, remotePort int) status {
	state.Lock()
	defer state.Unlock()

	if stateDir == "" || hostname == "" || remoteHost == "" || remotePort < 1 || remotePort > 65535 {
		return setErrorLocked(errors.New("invalid Tailscale proxy configuration"))
	}

	stopLocked()
	state.status = status{State: "starting", Phase: "starting", Hostname: hostname, RemoteHost: remoteHost, RemotePort: remotePort, Auth: auth{Mode: "interactive", InteractiveLogin: true}}

	server := &tsnet.Server{
		Dir:      stateDir,
		Hostname: hostname,
		// Login URLs are read from the structured LocalAPI/IPN bus, never logs.
		Logf:     func(string, ...any) {},
		UserLogf: func(string, ...any) {},
	}
	if runtime.GOOS == "android" {
		// Android does not provide a usable process temp directory. Keep
		// Tailscale's log policy state alongside its app-private node state.
		if err := os.MkdirAll(stateDir, 0700); err != nil {
			return setErrorLocked(err)
		}
		if err := os.Setenv("TS_LOGS_DIR", stateDir); err != nil {
			return setErrorLocked(err)
		}
		// Android blocks the netlink query used by Go's net.Interfaces. Kotlin
		// supplies the app-visible interfaces and addresses before startup.
		netmon.RegisterInterfaceGetter(func() ([]netmon.Interface, error) {
			interfaces.RLock()
			defer interfaces.RUnlock()
			return append([]netmon.Interface(nil), interfaces.values...), nil
		})
	}
	if err := server.Start(); err != nil {
		return setDiagnosticErrorLocked("control_plane_start_failed", "Tailscale control plane could not start", err)
	}

	client, err := server.LocalClient()
	if err != nil {
		_ = server.Close()
		return setDiagnosticErrorLocked("control_plane_client_failed", "Tailscale control plane client unavailable", err)
	}
	current := &instance{server: server, done: make(chan struct{})}
	state.instance = current
	currentStatus, err := client.Status(context.Background())
	if err != nil {
		stopLocked()
		return setDiagnosticErrorLocked("control_plane_status_failed", "Unable to read Tailscale control plane status", err)
	}
	if currentStatus.BackendState == ipn.Running.String() {
		state.status.ControlPlaneOnline = true
		state.status.TailnetOnline = len(currentStatus.TailscaleIPs) > 0
		return startRelayLocked(current, hostname, remoteHost, remotePort)
	}
	state.status.Phase = "control_plane"
	loginURL, err := startInteractiveLogin(client)
	if err != nil {
		stopLocked()
		return setDiagnosticErrorLocked("control_plane_login_failed", "Tailscale control plane login failed", err)
	}
	if loginURL != "" {
		state.status = status{State: "needs_login", Phase: "waiting_auth", Hostname: hostname, RemoteHost: remoteHost, RemotePort: remotePort, LoginURL: loginURL, Auth: auth{Mode: "interactive", InteractiveLogin: true}, DiagnosticCode: "auth_required", DiagnosticMessage: "Tailscale authorization is required"}
		return state.status
	}
	return startRelayLocked(current, hostname, remoteHost, remotePort)
}

func startInteractiveLogin(client *local.Client) (string, error) {
	ctx, cancel := context.WithTimeout(context.Background(), startupTimeout)
	defer cancel()
	// StartLoginInteractive delivers the authorization URL asynchronously via
	// the IPN bus, not Status(). Subscribe before requesting it so a URL emitted
	// by tsnet during startup or by the re-send below cannot be missed.
	watcher, err := client.WatchIPNBus(ctx, ipn.NotifyInitialState)
	if err != nil {
		return "", err
	}
	defer watcher.Close()
	if err := client.StartLoginInteractive(ctx); err != nil {
		return "", err
	}
	for {
		notify, err := watcher.Next()
		if err != nil {
			return "", err
		}
		if notify.BrowseToURL != nil && *notify.BrowseToURL != "" {
			return *notify.BrowseToURL, nil
		}
		if notify.State != nil && *notify.State == ipn.Running {
			return "", nil
		}
	}
}

func startRelayLocked(current *instance, hostname, remoteHost string, remotePort int) status {
	listener, err := net.Listen("tcp4", "127.0.0.1:0")
	if err != nil {
		stopLocked()
		return setErrorLocked(err)
	}
	current.listener = listener
	go serve(current, remoteHost, remotePort)
	ip4, ip6 := current.server.TailscaleIPs()
	state.status = status{
		State:              "ready",
		Phase:              "relay",
		BaseURL:            "http://" + listener.Addr().String(),
		Hostname:           hostname,
		TailnetIPv4:        addrString(ip4),
		TailnetIPv6:        addrString(ip6),
		RemoteHost:         remoteHost,
		RemotePort:         remotePort,
		Auth:               auth{Mode: "interactive", InteractiveLogin: true},
		ControlPlaneOnline: true,
		TailnetOnline:      true,
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
		state.Lock()
		if state.instance != nil && state.instance.server == server {
			state.status.State = "error"
			state.status.Phase = "relay"
			state.status.DiagnosticCode = dialDiagnosticCode(err)
			state.status.DiagnosticMessage = dialDiagnosticMessage(err)
			state.status.Error = sanitizeError(err.Error())
		}
		state.Unlock()
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

func dialDiagnosticCode(err error) string {
	if errors.Is(err, context.DeadlineExceeded) || strings.Contains(strings.ToLower(err.Error()), "timeout") {
		return "relay_dial_timeout"
	}
	if strings.Contains(strings.ToLower(err.Error()), "no such host") || strings.Contains(strings.ToLower(err.Error()), "name resolution") {
		return "peer_dns_resolution_failed"
	}
	return "relay_dial_failed"
}

func dialDiagnosticMessage(err error) string {
	switch dialDiagnosticCode(err) {
	case "relay_dial_timeout":
		return "Tailscale relay timed out while reaching the OpenCode server"
	case "peer_dns_resolution_failed":
		return "Tailscale could not resolve the OpenCode peer name"
	default:
		return "Tailscale relay could not reach the OpenCode server"
	}
}

func stopLocked() {
	current := state.instance
	if current != nil {
		if current.listener != nil {
			_ = current.listener.Close()
			<-current.done
		}
		_ = current.server.Close()
		state.instance = nil
	}
	state.status = status{State: "stopped"}
}

func setErrorLocked(err error, secret ...string) status {
	return setDiagnosticErrorLocked("native_error", "Tailscale native error", err, secret...)
}

func setDiagnosticErrorLocked(code, diagnostic string, err error, secret ...string) status {
	message := err.Error()
	for _, value := range secret {
		message = strings.ReplaceAll(message, value, "[redacted]")
	}
	state.status = status{State: "error", DiagnosticCode: code, DiagnosticMessage: diagnostic, Error: sanitizeError(message)}
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
