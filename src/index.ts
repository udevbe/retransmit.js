class Retransmitter {
  private pendingAckMessages: ArrayBuffer[] = [];
  private sendserial = 0;
  private receiveserial = 0;
  private processedserial = 0;
  private bufferlowestserial = 0;

  constructor(
    private readonly onSend: OnSend,
    private readonly onError: OnError
  ) {}

  onReceive(message: ArrayBuffer) {
    const serial = new DataView(message).getUint32(0, true);
  }
}
