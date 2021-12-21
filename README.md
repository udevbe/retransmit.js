# Retransmitting-WebSocket
A tiny zero dependency wrapper around a WebSocket to ensure no messages are lost after a network failure. This is useful if you are dealing with a stateful/mutable protocol over network.
Retransmitting-WebSocket ensures messages do not get lost nor are they sent or received multiple times.

Retransmit does not handle reconnecting for you. Use something like [ReconnectingWebsocket](https://github.com/pladaria/reconnecting-websocket#readme) and simply pass it to RetransmittingWebSocket.

This project was created for use in [Greenfield](https://github.com/udevbe/greenfield)

# Usage
Both sides need to wrap their `WebSocket` in a `RetransmittingWebSocket`.
```typescript
import ReconnectingWebSocket from 'reconnecting-websocket'
import { RetransmittingWebSocket } from 'retransmit.js'

// options are optional
const retransmittingWebSocket = new RetransmittingWebSocket({
  maxUnacknowledgedBufferSizeBytes: 100000, // Maximum cummulative size of all received messages before we confirm reception.
  maxUnacknowledgedMessages: 100, // Maximum cardinal size of all received messages before we confirm reception.
  maxUnacknowledgedTimeMs: 10000, // Time after last messages before we confirm reception.
  closeTimeoutMs: 60000, // Maximum time after network failure before we consider the connection closed.
})

// No need to make ReconnectingWebSocket queue messages, RetransmittingWebSocket will take care of it.
retransmittingWebSocket.useWebSocket(new ReconnectingWebSocket('ws://my.site.com'), [], { maxEnqueuedMessages: 0 }) // .
//☝️ The used WebSocket can be swapped on the fly. This is required server-side so you can use a new incoming 
// WebSocket instance each time the old one is disconnected. The only requirement is that the other side keeps using the same 
// retransmittingWebSocket object.

retransmittingWebSocket.onmessage = (event) => {
  // Simply handle application payload here like you would with a normal WebSocket.
}


const somePayload = new Uint8Array([1,2,3,4])
retransmitter.send(somePayload) // retransmitter ensures the payload will be delivered exactly once, regardless of the connection state.
```
