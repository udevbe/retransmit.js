import ReconnectingWebsocket from 'reconnecting-websocket'

const MSG_INITIAL_SERIAL = 1
const MSG_DATA = 2
const MSG_ACK = 3

export type OnReceive = (data:Uint8Array) => void

export default class Retransmitter {
  private pendingAckMessages: ArrayBuffer[] = []
  private receiveserial = 0
  private processedserial = 0
  private bufferlowestserial = 0
  private unacknowledgedsize = 0

  constructor(
    private ws: ReconnectingWebsocket,
    private readonly onReceive: OnReceive
  ) {
    ws.onopen = (event) => {
      ws.send(new Uint32Array([MSG_INITIAL_SERIAL, this.bufferlowestserial]))
      this.pendingAckMessages.forEach((msg) => {
        ws.send(msg)
      })
    }
    ws.onmessage = (event) => {
      const data = event.data as ArrayBuffer
      const typeid = new DataView(data).getUint32(0, true)
      if (typeid == MSG_INITIAL_SERIAL) {
        this.receiveserial = new DataView(data).getUint32(1)
      }
      if (typeid == MSG_DATA) {
        this.receiveserial++
        if (this.receiveserial > this.processedserial) {
          this.onReceive(new Uint8Array(data, 4))
          this.processedserial = this.receiveserial
        }
        this.unacknowledgedsize+= data.byteLength
        if (this.unacknowledgedsize > 50000) {
          ws.send(new Uint32Array([MSG_ACK, this.processedserial]))
          this.unacknowledgedsize=0
        }
      }
      if (typeid == MSG_ACK) {
        const senduntil = new DataView(data).getUint32(1)
        this.pendingAckMessages = this.pendingAckMessages.slice(senduntil - this.bufferlowestserial, this.pendingAckMessages.length)
        this.bufferlowestserial = senduntil
      }
    }
  }

  send(message :ArrayBuffer) {
    const data = new Uint8Array(message.byteLength+4)
    data.set(new Uint32Array([MSG_DATA]),0)
    data.set(new Uint8Array(message), 4)

    this.pendingAckMessages.push(data)

    if (this.ws.readyState==ReconnectingWebsocket.OPEN) {
      this.ws.send(data)
    }
  }

}
