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
  DATA_ACK,
  CLOSE,
  CLOSE_ACK,
}

export const defaultMaxBufferSizeBytes = 100000
export const defaultMaxUnacknowledgedMessages = 100
export const defaultMaxTimeMs = 10000
export const defaultCloseTimeoutMs = 60000
export const defaultReconnectIntervalMs = 250

export type ListenersMap = {
  error: Array<Events.WebSocketEventListenerMap['error']>
  message: Array<Events.WebSocketEventListenerMap['message']>
  open: Array<Events.WebSocketEventListenerMap['open']>
  close: Array<Events.WebSocketEventListenerMap['close']>
}

export type WebSocketLike = {
  binaryType: BinaryType
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
  private _binaryType: BinaryType = 'blob'
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
  private pendingCloseEvent?: Events.CloseEvent
  private pendingErrorEvent?: Events.ErrorEvent
  private closeAcknowledged?: boolean

  private listeners: ListenersMap = {
    error: [],
    message: [],
    open: [],
    close: [],
  }
  private _readyState: ReadyState = ReadyState.CONNECTING
  private readonly config: {
    maxUnacknowledgedBufferSizeBytes: number
    maxUnacknowledgedMessages: number
    maxUnacknowledgedTimeMs: number
    closeTimeoutMs: number
    reconnectIntervalMs: number
    webSocketFactory?: () => WebSocketLike
  }

  constructor(config?: Partial<RetransmittingWebSocket['config']>) {
    this.config = {
      maxUnacknowledgedBufferSizeBytes: defaultMaxBufferSizeBytes,
      maxUnacknowledgedMessages: defaultMaxUnacknowledgedMessages,
      maxUnacknowledgedTimeMs: defaultMaxTimeMs,
      closeTimeoutMs: defaultCloseTimeoutMs,
      reconnectIntervalMs: defaultReconnectIntervalMs,
      ...config,
    }
    if (this.config.webSocketFactory) {
      this.useWebSocket(this.config.webSocketFactory())
    }
  }

  get binaryType(): BinaryType {
    return this.ws ? this.ws.binaryType : this._binaryType
  }

  set binaryType(value: BinaryType) {
    this._binaryType = value
    if (this.ws) {
      this.ws.binaryType = value
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
      } else if (message instanceof Blob) {
        acc += message.size
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
  close(code = 1000, reason?: string): void {
    this.pendingCloseEvent = new Events.CloseEvent(code, reason, this)
    this.closeAcknowledged = false
    const closeHeader = new Uint32Array([RETRANSMIT_MSG_TYPE.CLOSE])
    this.pendingAckMessages.push(closeHeader)
    if (this.ws && this.ws.readyState === ReadyState.OPEN) {
      this.ws.send(closeHeader)
    }
    this.ensureClosedTimeoutTask(this.pendingCloseEvent)
    this._readyState = ReadyState.CLOSING
  }

  /**
   * Enqueue specified data to be transmitted to the server over the WebSocket connection
   */
  send(dataBody: ArrayBufferLike | string): void {
    const dataHeader = new Uint32Array([RETRANSMIT_MSG_TYPE.DATA])
    this.pendingAckMessages.push(dataHeader)
    this.pendingAckMessages.push(dataBody)
    if (this.ws && this.ws.readyState === ReadyState.OPEN) {
      this.ws.send(dataHeader)
      this.ws.send(dataBody)
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
      this.removeInternalWebSocketListeners()
    }
    this.ws = webSocket
    if (
      (this._readyState === ReadyState.CONNECTING || this._readyState === ReadyState.OPEN) &&
      this.ws.readyState === ReadyState.OPEN
    ) {
      this.handleInternalWebSocketOpen(new Events.Event('open', this))
    } else if (this.ws.readyState === ReadyState.CLOSED || this.ws.readyState === ReadyState.CLOSING) {
      throw new Error('WebSocket already closed or closing.')
    }
    this.addInternalWebSocketListeners()
  }

  private handleInternalWebSocketOpen(event: Events.Event) {
    if (this.ws === undefined) {
      throw new Error('BUG. Received open but no websocket was present.')
    }

    if (this._readyState !== ReadyState.CLOSING) {
      this.cancelClosedTimeoutTask()
    }
    this.ws.binaryType = this._binaryType

    // send enqueued messages (messages sent before websocket open event)
    if (this.ws && this.ws.readyState === ReadyState.OPEN) {
      this.ws.send(new Uint32Array([RETRANSMIT_MSG_TYPE.INITIAL_SERIAL, this.bufferLowestSerial]))
      for (const msg of this.pendingAckMessages) {
        this.ws.send(msg)
      }
    }

    // only send out open event once after first OPEN
    if (this._readyState === ReadyState.CONNECTING) {
      this.pendingErrorEvent = undefined
      this._readyState = ReadyState.OPEN
      if (this.onopen) {
        this.onopen(event)
      }
      this.listeners.open.forEach((listener) => callEventListener(event, listener))
    }
  }

  private handleInternalWebSocketMessage(event: MessageEvent) {
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

    if (typeId === RETRANSMIT_MSG_TYPE.DATA_ACK) {
      const sendUntil = new Uint32Array(this.receivedHeader, Uint32Array.BYTES_PER_ELEMENT, 1)[0]
      this.pendingAckMessages = this.pendingAckMessages.slice(
        sendUntil - this.bufferLowestSerial,
        this.pendingAckMessages.length,
      )
      this.bufferLowestSerial = sendUntil
      this.receivedHeader = undefined
      return
    }

    if (typeId === RETRANSMIT_MSG_TYPE.CLOSE_ACK) {
      this.receiveSerial++
      this.closeAcknowledged = true
      if (this.pendingCloseEvent) {
        this.closeInternal(this.pendingCloseEvent)
        this.ws?.close(this.pendingCloseEvent.code, this.pendingCloseEvent.reason)
      } else {
        //console.warn('Received a CLOSE_ACK without a pending close event. Server-Client state out of sync?')
        throw new Error('BUG. Received a CLOSE_ACK without a pending close event.')
      }
      this.receivedHeader = undefined
      return
    }

    if (typeId === RETRANSMIT_MSG_TYPE.CLOSE) {
      this.receiveSerial++
      const closeAckMessage = new Uint32Array([RETRANSMIT_MSG_TYPE.CLOSE_ACK])
      this.pendingAckMessages.push(closeAckMessage)
      if (this.ws && this.ws.readyState === ReadyState.OPEN) {
        this.ws.send(closeAckMessage)
      }
      this.closing()
      this.receivedHeader = undefined
      return
    }

    if (typeId === RETRANSMIT_MSG_TYPE.DATA) {
      this.receiveSerial++
      if (processData) {
        if (this.receiveSerial > this.processedSerial) {
          if (this._readyState === ReadyState.OPEN) {
            this.onmessage?.(event)
            this.listeners.message.forEach((listener) => callEventListener(event, listener))
          }

          this.processedSerial = this.receiveSerial
        }
        this.unacknowledgedSize += typeof event.data === 'string' ? event.data.length : event.data.byteLength
        this.unacknowledgedMessages++

        this.ensureUnacknowledgedTimoutTask()

        if (
          this.unacknowledgedSize > this.config.maxUnacknowledgedBufferSizeBytes ||
          this.unacknowledgedMessages > this.config.maxUnacknowledgedMessages
        ) {
          this.sendAck()
        }
        this.receivedHeader = undefined
      }
      return
    }
  }

  private handleInternalWebSocketError(event: Events.ErrorEvent) {
    this.pendingErrorEvent = event
  }

  private closing() {
    this._readyState = ReadyState.CLOSING
    this.cancelClosedTimeoutTask()
  }

  private closeInternal(event: Events.CloseEvent) {
    if (this.readyState !== ReadyState.CLOSING) {
      throw new Error('BUG. Ready state must be CLOSING before transitioning to CLOSED')
    }
    if (this._readyState === ReadyState.CLOSED) {
      throw new Error('BUG. Already closed.')
    }
    this.cancelClosedTimeoutTask()
    this._readyState = ReadyState.CLOSED
    if (this.pendingErrorEvent) {
      const pendingErrorEvent = this.pendingErrorEvent
      if (this.onerror) {
        this.onerror(pendingErrorEvent)
      }
      this.listeners.error.forEach((listener) => callEventListener(pendingErrorEvent, listener))
    }

    if (this.onclose) {
      this.onclose(event)
    }
    this.listeners.close.forEach((listener) => callEventListener(event, listener))
    this.removeInternalWebSocketListeners()
  }

  private ensureClosedTimeoutTask(event: Events.CloseEvent) {
    if (this._readyState === ReadyState.CLOSING || this._readyState === ReadyState.CLOSED || this.closedTimeoutTask) {
      return
    }
    this.closedTimeoutTask = setTimeout(() => {
      this.closedTimeoutTask = undefined
      this._readyState = ReadyState.CLOSING
      this.closeInternal(event)
    }, this.config.closeTimeoutMs)
  }

  private cancelClosedTimeoutTask() {
    if (this.closedTimeoutTask) {
      clearTimeout(this.closedTimeoutTask)
      this.closedTimeoutTask = undefined
    }
  }

  private handleInternalWebSocketClose(event: Events.CloseEvent) {
    if (
      this.readyState === ReadyState.CONNECTING ||
      this.readyState === ReadyState.OPEN ||
      this.closeAcknowledged === false
    ) {
      if (this.config.webSocketFactory) {
        const webSocketFactory = this.config.webSocketFactory
        setTimeout(() => this.useWebSocket(webSocketFactory()), this.config.reconnectIntervalMs)
      }
      this.ensureClosedTimeoutTask(event)
    } else if (this._readyState === ReadyState.CLOSING) {
      this.closeInternal(event)
    }
  }

  private removeInternalWebSocketListeners() {
    if (!this.ws) {
      return
    }
    this.ws.removeEventListener('open', this.handleInternalWebSocketOpen.bind(this))
    this.ws.removeEventListener('close', this.handleInternalWebSocketClose.bind(this))
    this.ws.removeEventListener('message', this.handleInternalWebSocketMessage.bind(this))
    // @ts-ignore
    this.ws.removeEventListener('error', this.handleInternalWebSocketError.bind(this))
  }

  private addInternalWebSocketListeners() {
    if (!this.ws) {
      return
    }
    this.ws.addEventListener('open', this.handleInternalWebSocketOpen.bind(this))
    this.ws.addEventListener('close', this.handleInternalWebSocketClose.bind(this))
    this.ws.addEventListener('message', this.handleInternalWebSocketMessage.bind(this))
    // @ts-ignore
    this.ws.addEventListener('error', this.handleInternalWebSocketError.bind(this))
  }

  private sendAck() {
    if (this.ws && this.ws.readyState === ReadyState.OPEN) {
      this.ws.send(new Uint32Array([RETRANSMIT_MSG_TYPE.DATA_ACK, this.processedSerial]))
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
      }, this.config.maxUnacknowledgedTimeMs)
    }
  }

  private cancelUnacknowledgedTimoutTask() {
    if (this.unacknowledgedTimoutTask) {
      clearTimeout(this.unacknowledgedTimoutTask)
      this.unacknowledgedTimoutTask = undefined
    }
  }
}
