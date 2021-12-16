import * as Events from './events'

export const enum ReadyState {
  CONNECTING,
  OPEN,
  CLOSING,
  CLOSED,
}

export const enum RETRANSMIT_MSG_TYPE {
  INITIAL_SERIAL = 1,
  DATA,
  ACK,
}

export const defaultMaxBufferSize = 100000
export const defaultMaxUnacknowledgedMessages = 100
export const defaultMaxTimeMs = 10000

export type ListenersMap = {
  error: Array<Events.WebSocketEventListenerMap['error']>
  message: Array<Events.WebSocketEventListenerMap['message']>
  open: Array<Events.WebSocketEventListenerMap['open']>
  close: Array<Events.WebSocketEventListenerMap['close']>
}

type WebSocketLike = {
  binaryType: string
  url: string
  extensions: string
  protocol: string
  bufferedAmount: number
  readyState: number
  close(code: number, reason: string | undefined): void
  send(message: ArrayBufferLike): void
  removeEventListener(name: string, eventListener: (event: any) => void): void
  addEventListener(name: string, eventListener: (event: any) => void): void
}

export class RetransmittingWebSocket {
  readonly binaryType: 'arraybuffer' = 'arraybuffer'
  readonly CONNECTING = ReadyState.CONNECTING
  readonly OPEN = ReadyState.OPEN
  readonly CLOSING = ReadyState.CLOSING
  readonly CLOSED = ReadyState.CLOSED
  /**
   * An event listener to be called when the WebSocket connection's readyState changes to CLOSED
   */
  onclose: ((event: Events.CloseEvent) => void) | null = null
  /**
   * An event listener to be called when an error occurs
   */
  onerror: ((event: Events.Event) => void) | null = null
  /**
   * An event listener to be called when a message is received from the server
   */
  onmessage: ((event: MessageEvent) => void) | null = null
  /**
   * An event listener to be called when the WebSocket connection's readyState changes to OPEN;
   * this indicates that the connection is ready to send and receive data
   */
  onopen: ((event: Event) => void) | null = null

  private pendingAckMessages: Uint8Array[] = []
  private receiveSerial = 0
  private processedSerial = 0
  private bufferLowestSerial = 0
  private unacknowledgedSize = 0
  private unacknowledgedMessages = 0
  private unacknowledgedTimoutTask?: ReturnType<typeof setTimeout>
  private ws?: WebSocketLike
  private _listeners: ListenersMap = {
    error: [],
    message: [],
    open: [],
    close: [],
  }

  constructor(
    private readonly ackTreshold: { maxBufferSize: number; maxUnacknowledgedMessages: number; maxTimeMs: number } = {
      maxBufferSize: defaultMaxBufferSize,
      maxUnacknowledgedMessages: defaultMaxUnacknowledgedMessages,
      maxTimeMs: defaultMaxTimeMs,
    },
  ) {}

  /**
   * The number of bytes of data that have been queued using calls to send() but not yet
   * transmitted to the network. This value resets to zero once all queued data has been sent.
   * This value does not reset to zero when the connection is closed; if you keep calling send(),
   * this will continue to climb. Read only
   */
  get bufferedAmount(): number {
    const bytes = this.pendingAckMessages.reduce((acc, message) => (acc += message.byteLength), 0)
    return bytes + (this.ws?.bufferedAmount ?? 0)
  }

  /**
   * The extensions selected by the server. This is currently only the empty string or a list of
   * extensions as negotiated by the connection
   */
  get extensions(): string {
    return this.ws?.extensions ?? ''
  }

  /**
   * A string indicating the name of the sub-protocol the server selected;
   * this will be one of the strings specified in the protocols parameter when creating the
   * WebSocket object
   */
  get protocol(): string {
    return this.ws?.protocol ?? ''
  }

  /**
   * The current state of the connection; this is one of the Ready state constants
   */
  get readyState(): number {
    return this.ws?.readyState ?? ReadyState.CLOSED
  }

  /**
   * The URL as resolved by the constructor
   */
  get url(): string {
    return this.ws?.url ?? ''
  }

  /**
   * Closes the WebSocket connection or connection attempt, if any. If the connection is already
   * CLOSED, this method does nothing
   */
  public close(code = 1000, reason?: string) {
    this.ws?.close(code, reason)
  }

  /**
   * Enqueue specified data to be transmitted to the server over the WebSocket connection
   */
  send(messageBody: ArrayBuffer | ArrayBufferView): void {
    const message = new Uint8Array(Uint32Array.BYTES_PER_ELEMENT + messageBody.byteLength)
    new Uint32Array(message.buffer, 0, 1)[0] = RETRANSMIT_MSG_TYPE.DATA

    message.set(
      ArrayBuffer.isView(messageBody)
        ? new Uint8Array(messageBody.buffer, messageBody.byteOffset, messageBody.byteLength)
        : new Uint8Array(messageBody),
      Uint32Array.BYTES_PER_ELEMENT,
    )

    this.pendingAckMessages.push(message)
    if (this.ws && this.ws.readyState === ReadyState.OPEN) {
      this.ws.send(message)
    }
  }

  /**
   * Register an event handler of a specific event type
   */
  public addEventListener<T extends keyof Events.WebSocketEventListenerMap>(
    type: T,
    listener: Events.WebSocketEventListenerMap[T],
  ): void {
    if (this._listeners[type]) {
      // @ts-ignore
      this._listeners[type].push(listener)
    }
  }

  public dispatchEvent(event: Event) {
    const listeners = this._listeners[event.type as keyof Events.WebSocketEventListenerMap]
    if (listeners) {
      for (const listener of listeners) {
        this._callEventListener(event, listener)
      }
    }
    return true
  }

  /**
   * Removes an event listener
   */
  public removeEventListener<T extends keyof Events.WebSocketEventListenerMap>(
    type: T,
    listener: Events.WebSocketEventListenerMap[T],
  ): void {
    if (this._listeners[type]) {
      // @ts-ignore
      this._listeners[type] = this._listeners[type].filter((l) => l !== listener)
    }
  }

  useWebSocket(webSocket: WebSocketLike): void {
    if (this.ws) {
      this._removeListeners()
    }
    this.ws = webSocket
    this._addListeners()
    if (this.ws.readyState === ReadyState.OPEN) {
      this._handleOpen(new Event('open'))
    }
  }

  private _callEventListener<T extends keyof Events.WebSocketEventListenerMap>(
    event: Events.WebSocketEventMap[T],
    listener: Events.WebSocketEventListenerMap[T],
  ) {
    if ('handleEvent' in listener) {
      // @ts-ignore
      listener.handleEvent(event)
    } else {
      // @ts-ignore
      listener(event)
    }
  }

  private _handleOpen = (event: Event) => {
    if (this.ws === undefined) {
      throw new Error('BUG. Received open but no websocket was present.')
    }

    this.ws.binaryType = this.binaryType

    // send enqueued messages (messages sent before websocket open event)
    this.ws.send(new Uint32Array([RETRANSMIT_MSG_TYPE.INITIAL_SERIAL, this.bufferLowestSerial]))
    for (const msg of this.pendingAckMessages) {
      this.ws.send(msg)
    }

    if (this.onopen) {
      this.onopen(event)
    }
    this._listeners.open.forEach((listener) => this._callEventListener(event, listener))
  }

  private _handleMessage = (event: MessageEvent) => {
    const data = event.data as ArrayBuffer
    const typeId = new Uint32Array(data, 0, 1)[0]

    if (typeId === RETRANSMIT_MSG_TYPE.INITIAL_SERIAL) {
      this.receiveSerial = new Uint32Array(data, Uint32Array.BYTES_PER_ELEMENT, 1)[0]
      return
    }

    if (typeId === RETRANSMIT_MSG_TYPE.DATA) {
      this.receiveSerial++
      if (this.receiveSerial > this.processedSerial) {
        const offsetEvent = { ...event, data: new Uint8Array(data, Uint32Array.BYTES_PER_ELEMENT) }
        this.onmessage?.(offsetEvent)
        this._listeners.message.forEach((listener) => this._callEventListener(offsetEvent, listener))

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

  private _handleError = (event: Events.ErrorEvent) => {
    if (this.onerror) {
      this.onerror(event)
    }
    this._listeners.error.forEach((listener) => this._callEventListener(event, listener))
  }

  private _handleClose = (event: Events.CloseEvent) => {
    if (this.onclose) {
      this.onclose(event)
    }
    this._listeners.close.forEach((listener) => this._callEventListener(event, listener))
  }

  private _removeListeners() {
    if (!this.ws) {
      return
    }
    this.ws.removeEventListener('open', this._handleOpen)
    this.ws.removeEventListener('close', this._handleClose)
    this.ws.removeEventListener('message', this._handleMessage)
    // @ts-ignore
    this.ws.removeEventListener('error', this._handleError)
  }

  private _addListeners() {
    if (!this.ws) {
      return
    }
    this.ws.addEventListener('open', this._handleOpen)
    this.ws.addEventListener('close', this._handleClose)
    this.ws.addEventListener('message', this._handleMessage)
    // @ts-ignore
    this.ws.addEventListener('error', this._handleError)
  }

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
      }, this.ackTreshold.maxTimeMs)
    }
  }

  private cancelUnacknowledgedTimoutTask() {
    if (this.unacknowledgedTimoutTask) {
      clearTimeout(this.unacknowledgedTimoutTask)
      this.unacknowledgedTimoutTask = undefined
    }
  }
}
