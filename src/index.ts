interface OnSend {}

interface OnReceiver {}

interface OnError {}

interface PendingAckMessage {
  serial: number
  message: ArrayBuffer
}

class Retransmitter {
  private pendingAckMessages:ArrayBuffer[] = []

  constructor(private readonly onSend: OnSend, private readonly onError: OnError) {
  }

  onReceive(message: ArrayBuffer) {
    const serial = new DataView(message).getUint32(0, true)

  }
}
