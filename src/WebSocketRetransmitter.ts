export const enum ReadyState {
  OPEN = 1,
  CLOSED = 3,
}

export const enum RETRANSMIT_MSG_TYPE {
  INITIAL_SERIAL = 1,
  DATA,
  ACK,
}

export const defaultMaxBufferSize = 100000
export const defaultMaxUnacknowledgedMessages = 100
export const defaultMaxTimeMs = 10000

export class WebSocketRetransmitter {
  private pendingAckMessages: Uint8Array[] = []
  private receiveSerial = 0
  private processedSerial = 0
  private bufferLowestSerial = 0

  private unacknowledgedSize = 0
  private unacknowledgedMessages = 0
  private unacknowledgedTimoutTask?: ReturnType<typeof setTimeout>

  private ws?: WebSocket

  constructor(
    private readonly onReceive: (data: Uint8Array) => void,
    private readonly ackTreshold: { maxBufferSize: number; maxUnacknowledgedMessages: number; maxTimeMs: number } = {
      maxBufferSize: defaultMaxBufferSize,
      maxUnacknowledgedMessages: defaultMaxUnacknowledgedMessages,
      maxTimeMs: defaultMaxTimeMs,
    },
  ) {}

  private sendAck() {
    if (this.ws && this.ws.readyState === ReadyState.OPEN) {
      this.ws.send(new Uint32Array([RETRANSMIT_MSG_TYPE.ACK, this.processedSerial]))
      this.unacknowledgedSize = 0
      this.unacknowledgedMessages = 0
      this.cancelUnacknowledgedTimoutTask()
    }
  }

  private ensureUnacknowledgedTimoutTask() {
    if (this.unacknowledgedTimoutTask === undefined) {
      this.unacknowledgedTimoutTask = setTimeout(() => {
        this.unacknowledgedTimoutTask = undefined
        this.sendAck()
      })
    }
  }

  private cancelUnacknowledgedTimoutTask() {
    if (this.unacknowledgedTimoutTask) {
      clearTimeout(this.unacknowledgedTimoutTask)
      this.unacknowledgedTimoutTask = undefined
    }
  }

  useWebSocket(webSocket: WebSocket): void {
    if (this.ws) {
      this.ws.onopen = null
      this.ws.onmessage = null
    }
    webSocket.onopen = () => {
      webSocket.send(new Uint32Array([RETRANSMIT_MSG_TYPE.INITIAL_SERIAL, this.bufferLowestSerial]))
      this.pendingAckMessages.forEach((msg) => webSocket.send(msg))
    }
    webSocket.onmessage = (event) => {
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
        this.unacknowledgedMessages++

        this.ensureUnacknowledgedTimoutTask()

        if (
          this.unacknowledgedSize > this.ackTreshold.maxBufferSize ||
          this.unacknowledgedMessages > this.ackTreshold.maxUnacknowledgedMessages
        ) {
          this.sendAck()
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

    this.ws = webSocket
  }

  send(messageBody: Uint8Array): void {
    const message = new Uint8Array(Uint32Array.BYTES_PER_ELEMENT + messageBody.length)
    new Uint32Array(message.buffer, 0, 1)[0] = RETRANSMIT_MSG_TYPE.DATA
    message.set(messageBody, Uint32Array.BYTES_PER_ELEMENT)

    this.pendingAckMessages.push(message)
    if (this.ws && this.ws.readyState === ReadyState.OPEN) {
      this.ws.send(message)
    }
  }
}
