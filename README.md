# Retransmit.js
A tiny zero dependency wrapper around a WebSocket to ensure no messages are lost after a network failure. This is useful if you are dealing with a stateful/mutable protocol over network.
Retransmit.js ensures messages do not get lost nor are they sent or received multiple times.

Retransmit does not handle reconnecting for you. Use something like [ReconnectingWebsocket](https://github.com/pladaria/reconnecting-websocket#readme) and pass it to retransmit as you would with a normal WebSocket.

# Usage
Both sides need to wrap their `WebSocket` in a `WebSocketRetransmitter`.
```typescript
import ReconnectingWebSocket from 'reconnecting-websocket'
import { WebSocketRetransmitter } from 'retransmit.js'

function onReceiveCallback(receivePayload: Uint8Array): void {
  // handle received application payload here
}

const retransmitter = new WebSocketRetransmitter(onReceiveCallback)
retransmitter.useWebSocket(new ReconnectingWebSocket('ws://my.site.com'))
//☝️ Server-side you can use a new incoming WebSocket instance each time the old one disconnected, as long as the other 
// side uses the same retransmitter object as well.

const somePayload = new Uint8Array([1,2,3,4])
retransmitter.send(somePayload) // retransmitter ensures the payload will be delivered exactly once, regardless of the connection state.
```
