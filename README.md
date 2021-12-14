# Retransmit.js
A zero dependency wrapper around a [ReconnectingWebsocket](https://github.com/pladaria/reconnecting-websocket#readme) to ensure no messages are lost after a network failure. This is useful if you are dealing with a stateful/mutable protocol over network.
Retransmit.js ensures messages do not get lost nor are they sent or received multiple times.

# Usage
Both sides need to wrap their `ReconnectingWebSocket` in a `WebSocketRetransmitter`.
```typescript
import ReconnectingWebSocket from 'reconnecting-websocket'
import { WebSocketRetransmitter } from 'retransmit.js'

function onReceiveCallback(receivePayload: Uint8Array): void {
  // handle received application payload here
}

const rws = new ReconnectingWebSocket('ws://my.site.com');
const retransmitter = new WebSocketRetransmitter(rws, onReceiveCallback)

const somePayload = new Uint8Array([1,2,3,4])
// Send application payload here. The retransmitter ensures the payload will be delivered exactly once, even on an unstable connection.
retransmitter.send(somePayload)
```
