# Retransmit.js
A tiny zero dependency wrapper around a WebSocket to ensure no messages are lost after a network failure. This is useful if you are dealing with a stateful/mutable protocol over network.
Retransmit.js ensures messages do not get lost nor are they sent or received multiple times. Because extra data is appended to each message, only 'arraybuffer' is supported as binary type. 

Retransmit does not handle reconnecting for you. Use something like [ReconnectingWebsocket](https://github.com/pladaria/reconnecting-websocket#readme) and simply pass it to RetransmittingWebSocket.

# Usage
Both sides need to wrap their `WebSocket` in a `RetransmittingWebSocket`.
```typescript
import ReconnectingWebSocket from 'reconnecting-websocket'
import { RetransmittingWebSocket } from 'retransmit.js'

const retransmittingWebSocket = new RetransmittingWebSocket()

retransmittingWebSocket.useWebSocket(new ReconnectingWebSocket('ws://my.site.com')) // .
//☝️ The used WebSocket can be swapped on the fly. This is required server-side so you can use a new incoming 
// WebSocket instance each time the old one is disconnected. The only requirement is that the other side keeps using the same 
// retransmittingWebSocket object.

retransmittingWebSocket.onmessage = (event) => {
  // Simply handle application payload here like you would with a normal WebSocket.
}


const somePayload = new Uint8Array([1,2,3,4])
retransmitter.send(somePayload) // retransmitter ensures the payload will be delivered exactly once, regardless of the connection state.
```
