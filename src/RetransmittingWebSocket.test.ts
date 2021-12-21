import WebSocket, { Server as WebSocketServer } from 'ws'

const PORT = 50123
const URL = `ws://localhost:${PORT}`

import { RetransmittingWebSocket, RETRANSMIT_MSG_TYPE, ReadyState } from './RetransmittingWebSocket'

describe('WebSocketRetransmitter', () => {
  function openRetransmittingWebSocket() {
    retransmittingWebSocket.useWebSocket(new WebSocket(URL))
  }

  async function useNewOpenWebSocket() {
    const openWebSocket = await new Promise<WebSocket>((resolve) => {
      const webSocket = new WebSocket(URL)
      return (webSocket.onopen = () => resolve(webSocket))
    })
    retransmittingWebSocket.useWebSocket(openWebSocket)
  }

  /**
   * Returns a real websocket from the other side.
   */
  function startServer() {
    wss = new WebSocketServer({ port: PORT })
    serverWebSocketOpen = new Promise<WebSocket>((resolve) => {
      wss.on('connection', (serverWebSocket) => {
        serverWebSocket.onmessage = (event) => {
          serverReceiveCallback(typeof event.data === 'string' ? event.data : new Uint8Array(event.data as ArrayBuffer))
        }
        resolve(serverWebSocket)
      })
    })
  }

  function stopServer() {
    if (serverWebSocketOpen) {
      serverWebSocketOpen.then((ws) => ws.close())
    }
    wss.close()
  }

  function someTime() {
    return new Promise((resolve) => setTimeout(resolve, 50))
  }

  function createRetransmittingWebSocket(config?: ConstructorParameters<typeof RetransmittingWebSocket>[0]) {
    retransmittingWebSocket = new RetransmittingWebSocket(config)
    retransmittingWebSocket.binaryType = 'arraybuffer'
    receiveCallback = jest.fn()
    retransmittingWebSocket.onmessage = (event) => {
      receiveCallback(typeof event.data === 'string' ? event.data : new Uint8Array(event.data as ArrayBuffer))
    }
  }

  let retransmittingWebSocket: RetransmittingWebSocket
  let receiveCallback: jest.Mock

  let serverReceiveCallback: jest.Mock
  let wss: WebSocketServer
  let serverWebSocketOpen: Promise<WebSocket>

  beforeEach(() => {
    serverReceiveCallback = jest.fn()
    startServer()
  })

  afterEach(() => {
    stopServer()
  })

  test('it sends a handshake after the websocket is opened', async () => {
    // given a closed websocket
    createRetransmittingWebSocket()

    // when websocket connection is opened
    openRetransmittingWebSocket()
    await serverWebSocketOpen
    await someTime()

    // then websocket receives a handshake
    expect(serverReceiveCallback).toHaveBeenCalledTimes(1)
    expect(serverReceiveCallback).toBeCalledWith(
      new Uint8Array([RETRANSMIT_MSG_TYPE.INITIAL_SERIAL, 0, 0, 0, 0, 0, 0, 0]),
    )
  })

  test('it sends a handshake and data after the websocket is opened', async () => {
    // given a closed websocket
    createRetransmittingWebSocket()

    // when the websocket is opened and data is sent
    openRetransmittingWebSocket()
    retransmittingWebSocket.send(new Uint8Array([5]))
    await serverWebSocketOpen
    await someTime()

    // then we get the encoded data sent out
    expect(serverReceiveCallback).toHaveBeenCalledTimes(3)
    expect(serverReceiveCallback).toBeCalledWith(new Uint8Array([RETRANSMIT_MSG_TYPE.DATA, 0, 0, 0]))
    expect(serverReceiveCallback).lastCalledWith(new Uint8Array([5]))
  })

  test('it sends a handshake and string data after the websocket is opened', async () => {
    // given a closed websocket
    createRetransmittingWebSocket()

    // when the websocket is opened and data is sent
    openRetransmittingWebSocket()
    retransmittingWebSocket.send('test123')
    await serverWebSocketOpen
    await someTime()

    // then we get the encoded data sent out
    expect(serverReceiveCallback).toHaveBeenCalledTimes(3)
    expect(serverReceiveCallback).toBeCalledWith(new Uint8Array([RETRANSMIT_MSG_TYPE.DATA, 0, 0, 0]))
    expect(serverReceiveCallback).lastCalledWith('test123')
  })

  test('it sends a handshake and previously buffered data after the websocket is opened', async () => {
    // given a closed websocket
    createRetransmittingWebSocket()

    // when data is sent before websocket is opened
    retransmittingWebSocket.send(new Uint8Array([5]))
    openRetransmittingWebSocket()
    await serverWebSocketOpen
    await someTime()

    // then a handshake and buffered data is sent
    expect(serverReceiveCallback).toHaveBeenCalledTimes(3)
    expect(serverReceiveCallback).toBeCalledWith(new Uint8Array([RETRANSMIT_MSG_TYPE.DATA, 0, 0, 0]))
    expect(serverReceiveCallback).lastCalledWith(new Uint8Array([5]))
  })

  test('it sends a handshake and previously buffered data after the websocket is reconnected', async () => {
    // given a closed websocket
    createRetransmittingWebSocket()

    // when data is sent after websocket is disconnected
    openRetransmittingWebSocket()
    await serverWebSocketOpen
    await someTime()
    stopServer()
    await someTime()

    retransmittingWebSocket.send(new Uint8Array([5]))

    startServer()
    openRetransmittingWebSocket()
    await serverWebSocketOpen
    await someTime()

    // then a handshake and buffered data is sent
    expect(serverReceiveCallback).toHaveBeenCalledTimes(4)
    expect(serverReceiveCallback).toBeCalledWith(new Uint8Array([RETRANSMIT_MSG_TYPE.DATA, 0, 0, 0]))
    expect(serverReceiveCallback).lastCalledWith(new Uint8Array([5]))
  })

  test('it sends a handshake and previously buffered data after an open websocket is used', async () => {
    // given a closed websocket
    createRetransmittingWebSocket()

    // when data is sent after websocket is disconnected
    openRetransmittingWebSocket()
    await serverWebSocketOpen
    await someTime()
    stopServer()
    await someTime()

    retransmittingWebSocket.send(new Uint8Array([5]))

    startServer()
    await useNewOpenWebSocket()
    await serverWebSocketOpen
    await someTime()

    // then a handshake and buffered data is sent
    expect(serverReceiveCallback).toHaveBeenCalledTimes(4)
    expect(serverReceiveCallback).toBeCalledWith(new Uint8Array([RETRANSMIT_MSG_TYPE.DATA, 0, 0, 0]))
    expect(serverReceiveCallback).lastCalledWith(new Uint8Array([5]))
  })

  test('it receives a handshake and data after the websocket is opened', async () => {
    // given a closed websocket
    createRetransmittingWebSocket()

    //when websocket is opened and data is received
    openRetransmittingWebSocket()
    const serverWebSocket = await serverWebSocketOpen
    serverWebSocket.send(new Uint32Array([RETRANSMIT_MSG_TYPE.INITIAL_SERIAL, 0]))
    serverWebSocket.send(new Uint32Array([RETRANSMIT_MSG_TYPE.DATA]))
    serverWebSocket.send(new Uint8Array([5]))
    await someTime()

    // then a handshake and data is received
    expect(receiveCallback).toHaveBeenCalledTimes(1)
    expect(receiveCallback).lastCalledWith(new Uint8Array([5]))
  })

  test('it receives a handshake and string data after the websocket is opened', async () => {
    // given a closed websocket
    createRetransmittingWebSocket()

    //when websocket is opened and data is received
    openRetransmittingWebSocket()
    const serverWebSocket = await serverWebSocketOpen
    serverWebSocket.send(new Uint32Array([RETRANSMIT_MSG_TYPE.INITIAL_SERIAL, 0]))
    serverWebSocket.send(new Uint8Array([RETRANSMIT_MSG_TYPE.DATA, 0, 0, 0]))
    serverWebSocket.send('test123')
    await someTime()

    // then a handshake and data is received
    expect(receiveCallback).toHaveBeenCalledTimes(1)
    expect(receiveCallback).lastCalledWith('test123')
  })

  test('it retransmits unacknowledged data after disconnect', async () => {
    // given a closed websocket
    createRetransmittingWebSocket()

    // when websocket is opened and data is sent
    openRetransmittingWebSocket()
    await serverWebSocketOpen
    retransmittingWebSocket.send(new Uint8Array([5]))
    await someTime()

    // then a handshake and data is sent over websocket
    expect(serverReceiveCallback).toHaveBeenCalledTimes(3)
    expect(serverReceiveCallback).toHaveBeenCalledWith(new Uint8Array([RETRANSMIT_MSG_TYPE.DATA, 0, 0, 0]))
    expect(serverReceiveCallback).lastCalledWith(new Uint8Array([5]))

    // and when the websocket is reconnected
    stopServer()
    startServer()
    openRetransmittingWebSocket()
    await someTime()

    // then a new handshake and the previously un-acked data is sent again
    expect(serverReceiveCallback).toHaveBeenCalledTimes(6)
    expect(serverReceiveCallback).toHaveBeenCalledWith(new Uint8Array([RETRANSMIT_MSG_TYPE.DATA, 0, 0, 0]))
    expect(serverReceiveCallback).lastCalledWith(new Uint8Array([5]))
  })

  // it can ignore retransmits it has already seen
  test('it receives unacknowledged data after disconnect', async () => {
    // given a closed websocket
    createRetransmittingWebSocket()

    // when websocket is opened and a serial and data is received
    openRetransmittingWebSocket()
    let serverWebSocket = await serverWebSocketOpen
    serverWebSocket.send(new Uint32Array([RETRANSMIT_MSG_TYPE.INITIAL_SERIAL, 0]))
    serverWebSocket.send(new Uint32Array([RETRANSMIT_MSG_TYPE.DATA]))
    serverWebSocket.send(new Uint8Array([5]))
    serverWebSocket.send(new Uint32Array([RETRANSMIT_MSG_TYPE.DATA]))
    serverWebSocket.send(new Uint8Array([6]))
    serverWebSocket.send(new Uint32Array([RETRANSMIT_MSG_TYPE.DATA]))
    serverWebSocket.send(new Uint8Array([7]))
    serverWebSocket.send(new Uint32Array([RETRANSMIT_MSG_TYPE.DATA]))
    serverWebSocket.send(new Uint8Array([8]))
    await someTime()

    // then the callback returns only the data corresponding to the received the serial
    expect(receiveCallback).toHaveBeenCalledTimes(4)
    expect(receiveCallback).lastCalledWith(new Uint8Array([8]))

    // and when websocket is reconnected and a new serial and old and new data is received
    stopServer()
    startServer()
    openRetransmittingWebSocket()
    serverWebSocket = await serverWebSocketOpen
    serverWebSocket.send(new Uint32Array([RETRANSMIT_MSG_TYPE.INITIAL_SERIAL, 0]))
    serverWebSocket.send(new Uint32Array([RETRANSMIT_MSG_TYPE.DATA]))
    serverWebSocket.send(new Uint8Array([5]))
    serverWebSocket.send(new Uint32Array([RETRANSMIT_MSG_TYPE.DATA]))
    serverWebSocket.send(new Uint8Array([6]))
    serverWebSocket.send(new Uint32Array([RETRANSMIT_MSG_TYPE.DATA]))
    serverWebSocket.send(new Uint8Array([7]))
    serverWebSocket.send(new Uint32Array([RETRANSMIT_MSG_TYPE.DATA]))
    serverWebSocket.send(new Uint8Array([8]))
    serverWebSocket.send(new Uint32Array([RETRANSMIT_MSG_TYPE.DATA]))
    serverWebSocket.send(new Uint8Array([9]))
    await someTime()

    // then the callback returns only the data corresponding to the newly received serial
    expect(receiveCallback).toHaveBeenCalledTimes(5)
    expect(receiveCallback).lastCalledWith(new Uint8Array([9]))

    // and when websocket is reconnected and a new serial and old and new data is received
    stopServer()
    startServer()
    openRetransmittingWebSocket()
    serverWebSocket = await serverWebSocketOpen
    serverWebSocket.send(new Uint32Array([RETRANSMIT_MSG_TYPE.INITIAL_SERIAL, 2]))
    serverWebSocket.send(new Uint32Array([RETRANSMIT_MSG_TYPE.DATA]))
    serverWebSocket.send(new Uint8Array([6]))
    serverWebSocket.send(new Uint32Array([RETRANSMIT_MSG_TYPE.DATA]))
    serverWebSocket.send(new Uint8Array([7]))
    serverWebSocket.send(new Uint32Array([RETRANSMIT_MSG_TYPE.DATA]))
    serverWebSocket.send(new Uint8Array([8]))
    serverWebSocket.send(new Uint32Array([RETRANSMIT_MSG_TYPE.DATA]))
    serverWebSocket.send(new Uint8Array([9]))
    serverWebSocket.send(new Uint32Array([RETRANSMIT_MSG_TYPE.DATA]))
    serverWebSocket.send(new Uint8Array([10]))
    await someTime()

    // then the callback returns only the data corresponding to the newly received serial
    expect(receiveCallback).toHaveBeenCalledTimes(6)
    expect(receiveCallback).lastCalledWith(new Uint8Array(new Uint8Array([10]).buffer))
  })

  test('it drops messages from internal buffer if it received an acknowledge', async () => {
    // given a closed websocket
    createRetransmittingWebSocket()

    // when websocket is opened and data is sent
    openRetransmittingWebSocket()
    const serverWebSocket = await serverWebSocketOpen
    retransmittingWebSocket.send(new Uint8Array([5]))
    retransmittingWebSocket.send(new Uint8Array([6]))
    retransmittingWebSocket.send(new Uint8Array([7]))
    await someTime()

    // then a handshake and data is sent over websocket
    expect(serverReceiveCallback).toHaveBeenCalledTimes(7) // handshake (1) + 3 messages (2*3) == 7
    expect(serverReceiveCallback).toBeCalledWith(new Uint8Array([RETRANSMIT_MSG_TYPE.DATA, 0, 0, 0]))
    expect(serverReceiveCallback).lastCalledWith(new Uint8Array([7]))

    // and when an acknowledgment is received and connection is reset
    serverWebSocket.send(new Uint32Array([RETRANSMIT_MSG_TYPE.DATA_ACK, 2]))
    await someTime()
    stopServer()
    startServer()
    openRetransmittingWebSocket()
    await someTime()

    // then only unacknowledged data is sent again
    expect(serverReceiveCallback).toHaveBeenCalledTimes(12) // handshake (1) + 3 messages (2*3) + handshake (1) + 2 messages (2*2) = 12
    expect(serverReceiveCallback).toBeCalledWith(new Uint8Array([RETRANSMIT_MSG_TYPE.DATA, 0, 0, 0]))
    expect(serverReceiveCallback).lastCalledWith(new Uint8Array([7]))
  })

  test('it sends an acknowledgement after enough bytes are sent', async () => {
    // given a closed websocket
    const maxUnacknowledgedBufferSizeBytes = 1000
    createRetransmittingWebSocket({ maxUnacknowledgedBufferSizeBytes })

    // when websocket is opened and serial is received
    openRetransmittingWebSocket()
    const serverWebSocket = await serverWebSocketOpen
    serverWebSocket.send(new Uint32Array([RETRANSMIT_MSG_TYPE.INITIAL_SERIAL, 0]))
    await someTime()

    // then only our own serial is sent
    expect(serverReceiveCallback).toHaveBeenCalledTimes(1) // just the serial

    // and when cumulative received message size threshold is crossed
    const longMessage = new Uint8Array(Math.ceil(maxUnacknowledgedBufferSizeBytes / 2.5)) // more then 1/3th of the buffer, less then 1/2'th

    serverWebSocket.send(new Uint32Array([RETRANSMIT_MSG_TYPE.DATA]))
    serverWebSocket.send(longMessage)
    await someTime()
    expect(serverReceiveCallback).toHaveBeenCalledTimes(1) // still just the serial

    serverWebSocket.send(new Uint32Array([RETRANSMIT_MSG_TYPE.DATA]))
    serverWebSocket.send(longMessage)
    await someTime()
    expect(serverReceiveCallback).toHaveBeenCalledTimes(1) // still just the serial

    serverWebSocket.send(new Uint32Array([RETRANSMIT_MSG_TYPE.DATA]))
    serverWebSocket.send(longMessage)
    await someTime()

    // then a single ack is sent
    expect(serverReceiveCallback).toHaveBeenCalledTimes(2) // serial + ACK
    expect(serverReceiveCallback).lastCalledWith(new Uint8Array([RETRANSMIT_MSG_TYPE.DATA_ACK, 0, 0, 0, 6, 0, 0, 0]))

    serverWebSocket.send(longMessage)
    await someTime()
    expect(serverReceiveCallback).toHaveBeenCalledTimes(2) // serial + only one ACK
  })

  test('it sends an acknowledgement after enough messages are sent', async () => {
    // given a closed websocket
    const maxUnacknowledgedMessages = 10
    createRetransmittingWebSocket({ maxUnacknowledgedMessages })

    // when websocket is opened and serial is received
    openRetransmittingWebSocket()
    const serverWebSocket = await serverWebSocketOpen
    serverWebSocket.send(new Uint32Array([RETRANSMIT_MSG_TYPE.INITIAL_SERIAL, 0]))
    await someTime()

    // then only our own serial is sent
    expect(serverReceiveCallback).toHaveBeenCalledTimes(1) // just the serial

    // and when cumulative received message count threshold is crossed
    for (let i = 0; i < maxUnacknowledgedMessages; i++) {
      serverWebSocket.send(new Uint32Array([RETRANSMIT_MSG_TYPE.DATA]))
      serverWebSocket.send(new Uint32Array([i]))
    }
    await someTime()
    expect(serverReceiveCallback).toHaveBeenCalledTimes(1) // still just the serial

    serverWebSocket.send(new Uint32Array([RETRANSMIT_MSG_TYPE.DATA]))
    serverWebSocket.send(new Uint32Array([123]))
    await someTime()

    // then a single ack is sent
    expect(serverReceiveCallback).toHaveBeenCalledTimes(2) // serial + ACK
    expect(serverReceiveCallback).lastCalledWith(
      // header + payload == x2
      new Uint8Array(new Uint32Array([RETRANSMIT_MSG_TYPE.DATA_ACK, (maxUnacknowledgedMessages + 1) * 2]).buffer),
    )
    serverWebSocket.send(new Uint32Array([RETRANSMIT_MSG_TYPE.DATA]))
    serverWebSocket.send(new Uint32Array([123]))
    await someTime()
    expect(serverReceiveCallback).toHaveBeenCalledTimes(2) // serial + only one ACK
  })

  test('it sends an acknowledgement after enough time has passed', async () => {
    // given a closed websocket
    const maxUnacknowledgedTimeMs = 250
    createRetransmittingWebSocket({ maxUnacknowledgedTimeMs })

    // when websocket is opened and serial is received
    openRetransmittingWebSocket()
    const serverWebSocket = await serverWebSocketOpen
    serverWebSocket.send(new Uint32Array([RETRANSMIT_MSG_TYPE.INITIAL_SERIAL, 0]))
    await someTime()

    // then only our own serial is sent
    expect(serverReceiveCallback).toHaveBeenCalledTimes(1) // just the serial

    // and when cumulative received message count threshold is crossed
    serverWebSocket.send(new Uint32Array([RETRANSMIT_MSG_TYPE.DATA]))
    serverWebSocket.send(new Uint32Array([123]))
    await someTime()
    expect(serverReceiveCallback).toHaveBeenCalledTimes(1) // still just the serial

    await new Promise((resolve) => setTimeout(resolve, maxUnacknowledgedTimeMs + 50))

    // then a single ack is sent
    expect(serverReceiveCallback).toHaveBeenCalledTimes(2) // serial + ACK
    expect(serverReceiveCallback).lastCalledWith(new Uint8Array([RETRANSMIT_MSG_TYPE.DATA_ACK, 0, 0, 0, 2, 0, 0, 0]))
    serverWebSocket.send(new Uint32Array([RETRANSMIT_MSG_TYPE.DATA]))
    serverWebSocket.send(new Uint32Array([123]))
    await someTime()
    expect(serverReceiveCallback).toHaveBeenCalledTimes(2) // serial + only one ACK
  })

  test('it does not emit a close event on reconnect within close timeout', async () => {
    // given a closed websocket
    createRetransmittingWebSocket()
    retransmittingWebSocket.onopen = jest.fn()
    retransmittingWebSocket.onclose = jest.fn()

    // when reconnected within the close timeout,
    openRetransmittingWebSocket()
    await serverWebSocketOpen
    stopServer()
    await someTime()
    expect(retransmittingWebSocket.readyState).toBe(ReadyState.OPEN)
    startServer()
    openRetransmittingWebSocket()
    await serverWebSocketOpen

    // then no close event is emitted.
    expect(retransmittingWebSocket.readyState).toBe(ReadyState.OPEN)
    expect(retransmittingWebSocket.onopen).toHaveBeenCalledTimes(1)
    expect(retransmittingWebSocket.onclose).not.toHaveBeenCalled()
  })

  test('it emits a close event once after close timeout and reconnection', async () => {
    // given a closed websocket
    const closeTimeoutMs = 250
    createRetransmittingWebSocket({ closeTimeoutMs })
    retransmittingWebSocket.onopen = jest.fn()
    retransmittingWebSocket.onclose = jest.fn()

    // when reconnected within the close timeout,
    openRetransmittingWebSocket()
    await serverWebSocketOpen
    stopServer()
    await new Promise((resolve) => setTimeout(resolve, closeTimeoutMs + 50))
    expect(retransmittingWebSocket.readyState).toBe(ReadyState.CLOSED)
    startServer()
    openRetransmittingWebSocket()
    await serverWebSocketOpen
    await someTime()

    // then no close event is emitted.
    expect(retransmittingWebSocket.readyState).toBe(ReadyState.CLOSED)
    expect(retransmittingWebSocket.onopen).toHaveBeenCalledTimes(1)
    expect(retransmittingWebSocket.onclose).toHaveBeenCalledTimes(1)
  })

  test('it sends a close message after a user initiated close.', async () => {
    // given a closed websocket
    createRetransmittingWebSocket()

    // when reconnected within the close timeout,
    openRetransmittingWebSocket()
    await serverWebSocketOpen
    retransmittingWebSocket.close(1234, 'test close')
    await someTime()

    // then no close event is emitted.
    expect(retransmittingWebSocket.readyState).toBe(ReadyState.CLOSING)
    expect(serverReceiveCallback).toHaveBeenCalledTimes(3)
    expect(serverReceiveCallback).toHaveBeenNthCalledWith(2, new Uint8Array([RETRANSMIT_MSG_TYPE.CLOSE, 0, 0, 0]))
    expect(serverReceiveCallback).lastCalledWith(JSON.stringify({ code: 1234, reason: 'test close' }))
  })

  test('it re-sends a close message after a user initiated close after a re-connect.', async () => {
    // given a closed websocket
    const closeTimeoutMs = 250
    createRetransmittingWebSocket({ closeTimeoutMs })

    // when reconnected within the close timeout,
    openRetransmittingWebSocket()
    await serverWebSocketOpen
    retransmittingWebSocket.close(1234, 'test close')
    await someTime()

    stopServer()
    startServer()
    openRetransmittingWebSocket()
    await someTime()

    // then no close event is emitted.
    expect(retransmittingWebSocket.readyState).toBe(ReadyState.CLOSING)
    expect(serverReceiveCallback).toHaveBeenCalledTimes(6)
    expect(serverReceiveCallback).toHaveBeenNthCalledWith(2, new Uint8Array([RETRANSMIT_MSG_TYPE.CLOSE, 0, 0, 0]))
    expect(serverReceiveCallback).toHaveBeenNthCalledWith(5, new Uint8Array([RETRANSMIT_MSG_TYPE.CLOSE, 0, 0, 0]))
    expect(serverReceiveCallback).lastCalledWith(JSON.stringify({ code: 1234, reason: 'test close' }))
  })

  test('it closes after a close ack timeout', async () => {
    // given a closed websocket
    const closeTimeoutMs = 250
    createRetransmittingWebSocket({ closeTimeoutMs })
    retransmittingWebSocket.onclose = jest.fn()

    // when reconnected within the close timeout,
    openRetransmittingWebSocket()
    await serverWebSocketOpen
    retransmittingWebSocket.close(1234, 'test close')
    expect(retransmittingWebSocket.readyState).toBe(ReadyState.CLOSING)

    await new Promise((resolve) => setTimeout(resolve, closeTimeoutMs + 50))

    // then no close event is emitted.
    expect(serverReceiveCallback).toHaveBeenCalledTimes(3)
    expect(retransmittingWebSocket.readyState).toBe(ReadyState.CLOSED)
    expect(retransmittingWebSocket.onclose).toHaveBeenCalledTimes(1)
  })

  test('it closes after a close ack is received', async () => {
    // given a closed websocket
    createRetransmittingWebSocket()
    retransmittingWebSocket.onclose = jest.fn()

    // when reconnected within the close timeout,
    openRetransmittingWebSocket()
    const serverWebSocket = await serverWebSocketOpen
    retransmittingWebSocket.close(1234, 'test close')
    expect(retransmittingWebSocket.readyState).toBe(ReadyState.CLOSING)

    serverWebSocket.send(new Uint32Array([RETRANSMIT_MSG_TYPE.CLOSE_ACK]))
    await someTime()

    // then no close event is emitted.
    expect(serverReceiveCallback).toHaveBeenCalledTimes(3)
    expect(retransmittingWebSocket.readyState).toBe(ReadyState.CLOSED)
    expect(retransmittingWebSocket.onclose).toHaveBeenCalledTimes(1)
  })

  test('it sends a close ack message and closes after a close message is received.', async () => {
    // given a closed websocket
    createRetransmittingWebSocket()
    retransmittingWebSocket.onclose = jest.fn()

    // when reconnected within the close timeout,
    openRetransmittingWebSocket()
    const serverWebSocket = await serverWebSocketOpen
    serverWebSocket.send(new Uint32Array([RETRANSMIT_MSG_TYPE.CLOSE]))
    serverWebSocket.send(JSON.stringify({ code: 1234, reason: 'test close' }))
    await someTime()

    // then no close event is emitted.
    expect(serverReceiveCallback).toHaveBeenCalledTimes(2)
    expect(serverReceiveCallback).lastCalledWith(new Uint8Array([RETRANSMIT_MSG_TYPE.CLOSE_ACK, 0, 0, 0]))
    expect(retransmittingWebSocket.readyState).toBe(ReadyState.CLOSED)
    expect(retransmittingWebSocket.onclose).toHaveBeenCalledTimes(1)
  })

  test('it re-sends a close ack message and closes after a close message is received after a reconnect', async () => {
    // given a closed websocket
    createRetransmittingWebSocket()
    retransmittingWebSocket.onclose = jest.fn()

    // when reconnected within the close timeout,
    openRetransmittingWebSocket()
    const serverWebSocket = await serverWebSocketOpen
    serverWebSocket.send(new Uint32Array([RETRANSMIT_MSG_TYPE.CLOSE]))
    serverWebSocket.send(JSON.stringify({ code: 1234, reason: 'test close' }))
    await someTime()

    stopServer()
    startServer()
    openRetransmittingWebSocket()
    await someTime()

    // then no close event is emitted.
    expect(serverReceiveCallback).toHaveBeenCalledTimes(4)
    expect(serverReceiveCallback).lastCalledWith(new Uint8Array([RETRANSMIT_MSG_TYPE.CLOSE_ACK, 0, 0, 0]))
    expect(retransmittingWebSocket.readyState).toBe(ReadyState.CLOSED)
    expect(retransmittingWebSocket.onclose).toHaveBeenCalledTimes(1)
  })
})
