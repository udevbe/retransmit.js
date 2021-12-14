import ReconnectingWebsocket from 'reconnecting-websocket'

export const enum RETRANSMIT_MSG_TYPE {
  INITIAL_SERIAL = 1,
  DATA,
  ACK,
}

export class WebSocketRetransmitter {
  private pendingAckMessages: Uint8Array[] = []
  private receiveSerial = 0
  private processedSerial = 0
  private bufferLowestSerial = 0
  private unacknowledgedSize = 0

  constructor(
    private ws: ReconnectingWebsocket,
    private readonly onReceive: (data: Uint8Array) => void,
    maxMsgBufferSize = 50000,
  ) {
    ws.onopen = () => {
      ws.send(new Uint32Array([RETRANSMIT_MSG_TYPE.INITIAL_SERIAL, this.bufferLowestSerial]))
      this.pendingAckMessages.forEach((msg) => ws.send(msg))
    }
    ws.onmessage = (event) => {
      const data = event.data as ArrayBuffer
      const typeId = new Uint32Array(data, 0, 1)[0]

      if (typeId === RETRANSMIT_MSG_TYPE.INITIAL_SERIAL) {
        this.receiveSerial = new Uint32Array(data, Uint32Array.BYTES_PER_ELEMENT, 1)[0]
        return
      }

      if (typeId === RETRANSMIT_MSG_TYPE.DATA) {
        this.receiveSerial++
        if (this.receiveSerial > this.processedSerial) {
          this.onReceive(new Uint8Array(data, Uint32Array.BYTES_PER_ELEMENT))
          this.processedSerial = this.receiveSerial
        }
        this.unacknowledgedSize += data.byteLength
        if (this.unacknowledgedSize > maxMsgBufferSize) {
          ws.send(new Uint32Array([RETRANSMIT_MSG_TYPE.ACK, this.processedSerial]))
          this.unacknowledgedSize = 0
        }
        return
      }

      if (typeId === RETRANSMIT_MSG_TYPE.ACK) {
        const sendUntil = new Uint32Array(data, Uint32Array.BYTES_PER_ELEMENT, 1)[0]
        this.pendingAckMessages = this.pendingAckMessages.slice(
          sendUntil - this.bufferLowestSerial,
          this.pendingAckMessages.length,
        )
        this.bufferLowestSerial = sendUntil
        return
      }
    }
  }

  send(messageBody: Uint8Array): void {
    const message = new Uint8Array(Uint32Array.BYTES_PER_ELEMENT + messageBody.length)
    new Uint32Array(message.buffer, 0, 1)[0] = RETRANSMIT_MSG_TYPE.DATA
    message.set(messageBody, Uint32Array.BYTES_PER_ELEMENT)

    this.pendingAckMessages.push(message)

    if (this.ws.readyState === ReconnectingWebsocket.OPEN) {
      this.ws.send(new Uint8Array(message))
    }
  }
}
