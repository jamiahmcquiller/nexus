package main

import (
	"fmt"
	"log"
	"os"
	"time"
)

func main() {
	fmt.Println("NEXUS Endpoint Agent v0.1.0")
	fmt.Println("Mode: Read-only inventory + heartbeat (MVP)")

	// Placeholder: enrollment and inventory collection will be implemented next
	hostname, _ := os.Hostname()
	fmt.Printf("Hostname: %s\n", hostname)

	ticker := time.NewTicker(5 * time.Minute)
	defer ticker.Stop()

	for {
		select {
		case <-ticker.C:
			log.Println("Heartbeat placeholder — will report inventory and status")
		}
	}
}
