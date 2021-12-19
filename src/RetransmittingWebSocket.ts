import * as Events from './events'

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
export const defaultCloseTimeoutMs = 3000

export type ListenersMap = {
  error: Array<Events.WebSocketEventListenerMap['error']>
  message: Array<Events.WebSocketEventListenerMap['message']>
  open: Array<Events.WebSocketEventListenerMap['open']>
  close: Array<Events.WebSocketEventListenerMap['close']>
}

export type WebSocketLike = {
  binaryType: string
  url: string
  extensions: string
  protocol: string
  bufferedAmount: number
  readyState: number
  close(code: number, reason: string | undefined): void
  send(message: ArrayBufferLike | string): void
  removeEventListener(name: string, eventListener: (event: any) => void): void
  addEventListener(name: string, eventListener: (event: any) => void): void
}

function callEventListener<T extends keyof Events.WebSocketEventListenerMap>(
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

export class RetransmittingWebSocket {
  readonly binaryType: 'arraybuffer' = 'arraybuffer'
  /**
   * An event listener to be called when the WebSocket connection's readyState changes to CLOSED
   */
  onclose: ((event: Events.CloseEvent) => void) | null = null
  /**
   * An event listener to be called when an error occurs
   */
  onerror: ((event: Events.ErrorEvent) => void) | null = null
  /**
   * An event listener to be called when a message is received from the server
   */
  onmessage: ((event: MessageEvent) => void) | null = null
  /**
   * An event listener to be called when the WebSocket connection's readyState changes to OPEN;
   * this indicates that the connection is ready to send and receive data
   */
  onopen: ((event: Events.Event) => void) | null = null

  private pendingAckMessages: (ArrayBufferLike | string)[] = []
  private receiveSerial = 0
  private processedSerial = 0
  private bufferLowestSerial = 0
  private unacknowledgedSize = 0
  private unacknowledgedMessages = 0
  private unacknowledgedTimoutTask?: ReturnType<typeof setTimeout>
  private closedTimeoutTask?: ReturnType<typeof setTimeout>
  private ws?: WebSocketLike
  private receivedHeader?: ArrayBuffer

  private listeners: ListenersMap = {
    error: [],
    message: [],
    open: [],
    close: [],
  }
  private _readyState: ReadyState = ReadyState.CLOSED
  private readonly config: {
    maxUnacknowledBufferSize: number
    maxUnacknowledgedMessages: number
    maxUnacknowledTimeMs: number
    closeTimeout: number
  }

  constructor(
    config?: Partial<{
      maxBufferSize: number
      maxUnacknowledgedMessages: number
      maxTimeMs: number
      closeTimeout: number
    }>,
  ) {
    this.config = {
      maxUnacknowledBufferSize: defaultMaxBufferSize,
      maxUnacknowledgedMessages: defaultMaxUnacknowledgedMessages,
      maxUnacknowledTimeMs: defaultMaxTimeMs,
      closeTimeout: defaultCloseTimeoutMs,
      ...config,
    }
  }

  /**
   * The number of bytes of data that have been queued using calls to send() but not yet
   * transmitted to the network. This value resets to zero once all queued data has been sent.
   * This value does not reset to zero when the connection is closed; if you keep calling send(),
   * this will continue to climb. Read only
   */
  get bufferedAmount(): number {
    const bytes = this.pendingAckMessages.reduce((acc, message) => {
      if (typeof message === 'string') {
        acc += message.length // not byte size
      } else {
        acc += message.byteLength
      }
      return acc
    }, 0)
    return bytes + (this.ws ? this.ws.bufferedAmount : 0)
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
    return this._readyState
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
  public close(code = 1000, reason?: string): void {
    this.ws?.close(code, reason)
  }

  /**
   * Enqueue specified data to be transmitted to the server over the WebSocket connection
   */
  send(messageBody: ArrayBufferLike | string): void {
    const header = new Uint32Array([RETRANSMIT_MSG_TYPE.DATA])
    this.pendingAckMessages.push(header)
    this.pendingAckMessages.push(messageBody)
    if (this.ws && this.ws.readyState === ReadyState.OPEN) {
      this.ws.send(header)
      this.ws.send(messageBody)
    }
  }

  /**
   * Register an event handler of a specific event type
   */
  public addEventListener<T extends keyof Events.WebSocketEventListenerMap>(
    type: T,
    listener: Events.WebSocketEventListenerMap[T],
  ): void {
    if (this.listeners[type]) {
      // @ts-ignore
      this.listeners[type].push(listener)
    }
  }

  public dispatchEvent(event: Events.Event): boolean {
    const listeners = this.listeners[event.type as keyof Events.WebSocketEventListenerMap]
    if (listeners) {
      for (const listener of listeners) {
        callEventListener(event, listener)
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
    if (this.listeners[type]) {
      // @ts-ignore
      this.listeners[type] = this.listeners[type].filter((l) => l !== listener)
    }
  }

  useWebSocket(webSocket: WebSocketLike): void {
    if (this.ws) {
      this.removeListeners()
    }
    this.ws = webSocket
    this.addListeners()
    if (this.ws.readyState === ReadyState.OPEN) {
      this.handleOpen(new Events.Event('open', this.ws))
    } else if (this.ws.readyState === ReadyState.CLOSED) {
      this.handleClose(new Events.CloseEvent(1000, 'closed', this.ws))
    }
  }

  private handleOpen(event: Events.Event) {
    if (this.ws === undefined) {
      throw new Error('BUG. Received open but no websocket was present.')
    }

    this._readyState = ReadyState.OPEN
    this.cancelClosedTimeoutTask()
    this.ws.binaryType = this.binaryType

    // send enqueued messages (messages sent before websocket open event)
    if (this.ws && this.ws.readyState === ReadyState.OPEN) {
      this.ws.send(new Uint32Array([RETRANSMIT_MSG_TYPE.INITIAL_SERIAL, this.bufferLowestSerial]))
      for (const msg of this.pendingAckMessages) {
        this.ws.send(msg)
      }
    }

    // only send out open event
    if (this.onopen) {
      this.onopen(event)
    }
    this.listeners.open.forEach((listener) => callEventListener(event, listener))
  }

  private handleMessage(event: MessageEvent) {
    let processData = false
    if (this.receivedHeader === undefined) {
      this.receivedHeader = event.data as ArrayBuffer
    } else {
      processData = true
    }

    const typeId = new Uint32Array(this.receivedHeader, 0, 1)[0]

    if (typeId === RETRANSMIT_MSG_TYPE.INITIAL_SERIAL) {
      this.receiveSerial = new Uint32Array(this.receivedHeader, Uint32Array.BYTES_PER_ELEMENT, 1)[0]
      this.receivedHeader = undefined
      return
    }

    if (typeId === RETRANSMIT_MSG_TYPE.ACK) {
      const sendUntil = new Uint32Array(this.receivedHeader, Uint32Array.BYTES_PER_ELEMENT, 1)[0]
      this.pendingAckMessages = this.pendingAckMessages.slice(
        sendUntil - this.bufferLowestSerial,
        this.pendingAckMessages.length,
      )
      this.bufferLowestSerial = sendUntil
      this.receivedHeader = undefined
      return
    }

    if (processData && typeId === RETRANSMIT_MSG_TYPE.DATA) {
      this.receiveSerial++
      if (this.receiveSerial > this.processedSerial) {
        this.onmessage?.(event)
        this.listeners.message.forEach((listener) => callEventListener(event, listener))

        this.processedSerial = this.receiveSerial
      }
      this.unacknowledgedSize += typeof event.data === 'string' ? event.data.length : event.data.byteLength
      this.unacknowledgedMessages++

      this.ensureUnacknowledgedTimoutTask()

      if (
        this.unacknowledgedSize > this.config.maxUnacknowledBufferSize ||
        this.unacknowledgedMessages > this.config.maxUnacknowledgedMessages
      ) {
        this.sendAck()
      }
      this.receivedHeader = undefined
      return
    }
  }

  private handleError(event: Events.ErrorEvent) {
    if (this.onerror) {
      this.onerror(event)
    }
    this.listeners.error.forEach((listener) => callEventListener(event, listener))
  }

  private ensureClosedTimeoutTask(event: Events.CloseEvent) {
    if (this.closedTimeoutTask) {
      return
    }
    this.closedTimeoutTask = setTimeout(() => {
      this._readyState = ReadyState.CLOSED
      this.closedTimeoutTask = undefined
      if (this.onclose) {
        this.onclose(event)
      }
      this.listeners.close.forEach((listener) => callEventListener(event, listener))
    }, this.config.closeTimeout)
  }

  private cancelClosedTimeoutTask() {
    if (this.closedTimeoutTask) {
      clearTimeout(this.closedTimeoutTask)
    }
  }

  private handleClose(event: Events.CloseEvent) {
    this.ensureClosedTimeoutTask(event)
  }

  private removeListeners() {
    if (!this.ws) {
      return
    }
    this.ws.removeEventListener('open', this.handleOpen.bind(this))
    this.ws.removeEventListener('close', this.handleClose.bind(this))
    this.ws.removeEventListener('message', this.handleMessage.bind(this))
    // @ts-ignore
    this.ws.removeEventListener('error', this.handleError.bind(this))
  }

  private addListeners() {
    if (!this.ws) {
      return
    }
    this.ws.addEventListener('open', this.handleOpen.bind(this))
    this.ws.addEventListener('close', this.handleClose.bind(this))
    this.ws.addEventListener('message', this.handleMessage.bind(this))
    // @ts-ignore
    this.ws.addEventListener('error', this.handleError.bind(this))
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
      }, this.config.maxUnacknowledTimeMs)
    }
  }

  private cancelUnacknowledgedTimoutTask() {
    if (this.unacknowledgedTimoutTask) {
      clearTimeout(this.unacknowledgedTimoutTask)
      this.unacknowledgedTimoutTask = undefined
    }
  }
}
