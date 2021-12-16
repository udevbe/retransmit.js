import WebSocket, { Server as WebSocketServer } from 'ws'

const PORT = 50123
const URL = `ws://localhost:${PORT}`

import {
  RetransmittingWebSocket,
  RETRANSMIT_MSG_TYPE,
  defaultMaxBufferSize,
  defaultMaxUnacknowledgedMessages,
  defaultMaxTimeMs,
} from './RetransmittingWebSocket'

describe('WebSocketRetransmitter', () => {
  function openRetransmittingWebSocket() {
    retransmittingWebSocket.useWebSocket(new WebSocket(URL))
  }

  /**
   * Returns a real websocket from the other side.
   */
  function startServer() {
    wss = new WebSocketServer({ port: PORT })
    serverWebSocketOpen = new Promise<WebSocket>((resolve) => {
      wss.on('connection', (serverWebSocket) => {
        serverWebSocket.onmessage = (event) => {
          serverReceiveCallback(new Uint8Array(event.data as ArrayBuffer))
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

  let retransmittingWebSocket: RetransmittingWebSocket
  let receiveCallback: jest.Mock

  let serverReceiveCallback: jest.Mock
  let wss: WebSocketServer
  let serverWebSocketOpen: Promise<WebSocket>

  beforeEach(() => {
    retransmittingWebSocket = new RetransmittingWebSocket()
    receiveCallback = jest.fn()
    retransmittingWebSocket.onmessage = (event) => {
      receiveCallback(new Uint8Array(event.data))
    }

    serverReceiveCallback = jest.fn()
    startServer()
  })

  afterEach(() => {
    stopServer()
  })

  test('it sends a handshake after the websocket is opened', async () => {
    // given a closed websocket

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

    // when the websocket is opened and data is sent
    openRetransmittingWebSocket()
    retransmittingWebSocket.send(new Uint8Array([5]))
    await serverWebSocketOpen
    await someTime()

    // then we get the encoded data sent out
    expect(serverReceiveCallback).toHaveBeenCalledTimes(2)
    expect(serverReceiveCallback).lastCalledWith(new Uint8Array([RETRANSMIT_MSG_TYPE.DATA, 0, 0, 0, 5]))
  })

  test('it sends a handshake and previously buffered data after the websocket is opened', async () => {
    // given a closed websocket

    // when data is sent before websocket is opened
    retransmittingWebSocket.send(new Uint8Array([5]))
    openRetransmittingWebSocket()
    await serverWebSocketOpen
    await someTime()

    // then a handshake and buffered data is sent
    expect(serverReceiveCallback).toHaveBeenCalledTimes(2)
    expect(serverReceiveCallback).lastCalledWith(new Uint8Array([RETRANSMIT_MSG_TYPE.DATA, 0, 0, 0, 5]))
  })

  test('it receives a handshake and data after the websocket is opened', async () => {
    // given a closed websocket

    //when websocket is opened and data is received
    openRetransmittingWebSocket()
    const serverWebSocket = await serverWebSocketOpen
    serverWebSocket.send(new Uint32Array([RETRANSMIT_MSG_TYPE.INITIAL_SERIAL, 0]))
    serverWebSocket.send(new Uint32Array([RETRANSMIT_MSG_TYPE.DATA, 5]))
    await someTime()

    // then a handshake and data is received
    expect(receiveCallback).toHaveBeenCalledTimes(1)
    expect(receiveCallback).lastCalledWith(new Uint8Array(new Uint32Array([5]).buffer))
  })

  test('it retransmits unacknowledged data after disconnect', async () => {
    // given a closed websocket

    // when websocket is opened and data is sent
    openRetransmittingWebSocket()
    await serverWebSocketOpen
    retransmittingWebSocket.send(new Uint8Array([5]))
    await someTime()

    // then a handshake and data is sent over websocket
    expect(serverReceiveCallback).toHaveBeenCalledTimes(2)
    expect(serverReceiveCallback).lastCalledWith(new Uint8Array([RETRANSMIT_MSG_TYPE.DATA, 0, 0, 0, 5]))

    // and when the websocket is reconnected
    stopServer()
    startServer()
    openRetransmittingWebSocket()
    await someTime()

    // then a new handshake and the previously un-acked data is sent again
    expect(serverReceiveCallback).toHaveBeenCalledTimes(4)
    expect(serverReceiveCallback).lastCalledWith(new Uint8Array([RETRANSMIT_MSG_TYPE.DATA, 0, 0, 0, 5]))
  })

  // it can ignore retransmits it has already seen
  test('it receives unacknowledged data after disconnect', async () => {
    // given a closed websocket

    // when websocket is opened and a serial and data is received
    openRetransmittingWebSocket()
    let serverWebSocket = await serverWebSocketOpen
    serverWebSocket.send(new Uint32Array([RETRANSMIT_MSG_TYPE.INITIAL_SERIAL, 0]))
    serverWebSocket.send(new Uint32Array([RETRANSMIT_MSG_TYPE.DATA, 5]))
    serverWebSocket.send(new Uint32Array([RETRANSMIT_MSG_TYPE.DATA, 6]))
    serverWebSocket.send(new Uint32Array([RETRANSMIT_MSG_TYPE.DATA, 7]))
    serverWebSocket.send(new Uint32Array([RETRANSMIT_MSG_TYPE.DATA, 8]))
    await someTime()

    // then the callback returns only the data corresponding to the received the serial
    expect(receiveCallback).toHaveBeenCalledTimes(4)
    expect(receiveCallback).lastCalledWith(new Uint8Array(new Uint32Array([8]).buffer))

    // and when websocket is reconnected and a new serial and old and new data is received
    stopServer()
    startServer()
    openRetransmittingWebSocket()
    serverWebSocket = await serverWebSocketOpen
    serverWebSocket.send(new Uint32Array([RETRANSMIT_MSG_TYPE.INITIAL_SERIAL, 0]))
    serverWebSocket.send(new Uint32Array([RETRANSMIT_MSG_TYPE.DATA, 5]))
    serverWebSocket.send(new Uint32Array([RETRANSMIT_MSG_TYPE.DATA, 6]))
    serverWebSocket.send(new Uint32Array([RETRANSMIT_MSG_TYPE.DATA, 7]))
    serverWebSocket.send(new Uint32Array([RETRANSMIT_MSG_TYPE.DATA, 8]))
    serverWebSocket.send(new Uint32Array([RETRANSMIT_MSG_TYPE.DATA, 9]))
    await someTime()

    // then the callback returns only the data corresponding to the newly received serial
    expect(receiveCallback).toHaveBeenCalledTimes(5)
    expect(receiveCallback).lastCalledWith(new Uint8Array(new Uint32Array([9]).buffer))

    // and when websocket is reconnected and a new serial and old and new data is received
    stopServer()
    startServer()
    openRetransmittingWebSocket()
    serverWebSocket = await serverWebSocketOpen
    serverWebSocket.send(new Uint32Array([RETRANSMIT_MSG_TYPE.INITIAL_SERIAL, 2]))
    serverWebSocket.send(new Uint32Array([RETRANSMIT_MSG_TYPE.DATA, 7]))
    serverWebSocket.send(new Uint32Array([RETRANSMIT_MSG_TYPE.DATA, 8]))
    serverWebSocket.send(new Uint32Array([RETRANSMIT_MSG_TYPE.DATA, 9]))
    serverWebSocket.send(new Uint32Array([RETRANSMIT_MSG_TYPE.DATA, 10]))
    await someTime()

    // then the callback returns only the data corresponding to the newly received serial
    expect(receiveCallback).toHaveBeenCalledTimes(6)
    expect(receiveCallback).lastCalledWith(new Uint8Array(new Uint32Array([10]).buffer))
  })

  test('it drops messages from internal buffer if it received an acknowledge', async () => {
    // given a closed websocket

    // when websocket is opened and data is sent
    openRetransmittingWebSocket()
    const serverWebSocket = await serverWebSocketOpen
    retransmittingWebSocket.send(new Uint8Array([5]))
    retransmittingWebSocket.send(new Uint8Array([6]))
    retransmittingWebSocket.send(new Uint8Array([7]))
    await someTime()

    // then a handshake and data is sent over websocket
    expect(serverReceiveCallback).toHaveBeenCalledTimes(4)
    expect(serverReceiveCallback).lastCalledWith(new Uint8Array([RETRANSMIT_MSG_TYPE.DATA, 0, 0, 0, 7]))

    // and when an acknowledgment is received and connection is reset
    serverWebSocket.send(new Uint32Array([RETRANSMIT_MSG_TYPE.ACK, 1]))
    await someTime()
    stopServer()
    startServer()
    openRetransmittingWebSocket()
    await someTime()

    // then only unacknowledged data is sent again
    expect(serverReceiveCallback).toHaveBeenCalledTimes(7)
    expect(serverReceiveCallback).lastCalledWith(new Uint8Array([RETRANSMIT_MSG_TYPE.DATA, 0, 0, 0, 7]))
  })

  test('it sends an acknowledgement after enough bytes are sent', async () => {
    // given a closed websocket

    // when websocket is opened and serial is received
    openRetransmittingWebSocket()
    const serverWebSocket = await serverWebSocketOpen
    serverWebSocket.send(new Uint32Array([RETRANSMIT_MSG_TYPE.INITIAL_SERIAL, 0]))
    await someTime()

    // then only our own serial is sent
    expect(serverReceiveCallback).toHaveBeenCalledTimes(1) // just the serial

    // and when cumulative received message size threshold is crossed
    const mylongmessage = new Uint8Array(Math.ceil(defaultMaxBufferSize / 2.5)) // more then 1/3th of the buffer, less then 1/2'th
    mylongmessage.set(new Uint8Array(new Uint32Array([RETRANSMIT_MSG_TYPE.DATA, 1, 2, 3, 4, 5]).buffer), 0)

    serverWebSocket.send(mylongmessage)
    await someTime()
    expect(serverReceiveCallback).toHaveBeenCalledTimes(1) // still just the serial

    serverWebSocket.send(mylongmessage)
    await someTime()
    expect(serverReceiveCallback).toHaveBeenCalledTimes(1) // still just the serial

    serverWebSocket.send(mylongmessage)
    await someTime()

    // then a single ack is sent
    expect(serverReceiveCallback).toHaveBeenCalledTimes(2) // serial + ACK
    expect(serverReceiveCallback).lastCalledWith(new Uint8Array([RETRANSMIT_MSG_TYPE.ACK, 0, 0, 0, 3, 0, 0, 0]))

    serverWebSocket.send(mylongmessage)
    await someTime()
    expect(serverReceiveCallback).toHaveBeenCalledTimes(2) // serial + only one ACK
  })

  test('it sends an acknowledgement after enough messages are sent', async () => {
    // given a closed websocket

    // when websocket is opened and serial is received
    openRetransmittingWebSocket()
    const serverWebSocket = await serverWebSocketOpen
    serverWebSocket.send(new Uint32Array([RETRANSMIT_MSG_TYPE.INITIAL_SERIAL, 0]))
    await someTime()

    // then only our own serial is sent
    expect(serverReceiveCallback).toHaveBeenCalledTimes(1) // just the serial

    // and when cumulative received message count threshold is crossed
    for (let i = 0; i < defaultMaxUnacknowledgedMessages; i++) {
      serverWebSocket.send(new Uint32Array([RETRANSMIT_MSG_TYPE.DATA, i]))
    }
    await someTime()
    expect(serverReceiveCallback).toHaveBeenCalledTimes(1) // still just the serial

    serverWebSocket.send(new Uint32Array([RETRANSMIT_MSG_TYPE.DATA, 123]))
    await someTime()

    // then a single ack is sent
    expect(serverReceiveCallback).toHaveBeenCalledTimes(2) // serial + ACK
    expect(serverReceiveCallback).lastCalledWith(
      new Uint8Array(new Uint32Array([RETRANSMIT_MSG_TYPE.ACK, defaultMaxUnacknowledgedMessages + 1]).buffer),
    )
    serverWebSocket.send(new Uint32Array([RETRANSMIT_MSG_TYPE.DATA, 123]))
    await someTime()
    expect(serverReceiveCallback).toHaveBeenCalledTimes(2) // serial + only one ACK
  })

  test(
    'it sends an acknowledgement after enough time has passed',
    async () => {
      // given a closed websocket

      // when websocket is opened and serial is received
      openRetransmittingWebSocket()
      const serverWebSocket = await serverWebSocketOpen
      serverWebSocket.send(new Uint32Array([RETRANSMIT_MSG_TYPE.INITIAL_SERIAL, 0]))
      await someTime()

      // then only our own serial is sent
      expect(serverReceiveCallback).toHaveBeenCalledTimes(1) // just the serial

      // and when cumulative received message count threshold is crossed
      serverWebSocket.send(new Uint32Array([RETRANSMIT_MSG_TYPE.DATA, 123]))
      await someTime()
      expect(serverReceiveCallback).toHaveBeenCalledTimes(1) // still just the serial

      await new Promise((resolve) => setTimeout(resolve, defaultMaxTimeMs + 100))

      // then a single ack is sent
      expect(serverReceiveCallback).toHaveBeenCalledTimes(2) // serial + ACK
      expect(serverReceiveCallback).lastCalledWith(new Uint8Array([RETRANSMIT_MSG_TYPE.ACK, 0, 0, 0, 1, 0, 0, 0]))
      serverWebSocket.send(new Uint32Array([RETRANSMIT_MSG_TYPE.DATA, 123]))
      await someTime()
      expect(serverReceiveCallback).toHaveBeenCalledTimes(2) // serial + only one ACK
    },
    defaultMaxTimeMs + 1000,
  )
})
