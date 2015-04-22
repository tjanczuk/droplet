Droplet: small drop from a token bucket [![Build Status](https://travis-ci.org/tjanczuk/droplet.svg?branch=master)](https://travis-ci.org/tjanczuk/droplet)
====

Droplet is a client/server implementation of the [token bucket](http://en.wikipedia.org/wiki/Token_bucket) algorithm. You can use droplet to throttle access to resources in a server farm, for example enforce rate limits for HTTP requests in a web application. 

Droplet server is a zero-configuration server which allows buckets to be defined and reconfigured dynamically. For every named token bucket you can define and separately enforce per second, minute, hour, day, week, and month rate limits.

Droplet provides a Node.js server that implements the token bucket logic, and a Node.js client library to communicate with the server. Droplet defines a [Protocol Buffers](https://developers.google.com/protocol-buffers/) over [WebSockets](http://en.wikipedia.org/wiki/WebSocket) protocol that allows non-Node.js clients to communicate with the droplet server.

### Getting started

Install droplet:

```
npm install droplet
```

On the server:

```javascript
var droplet = require('droplet');

var server = droplet.create_server({ port: 3000 });
```

On the client:

```javacript
var droplet = require('droplet');

var client = droplet.create_client({ url: 'ws://localhost:3000' });

client.take({ bucket: 'foo', ls: 100 }, function (error, result) {
    if (error) throw error;
    console.log('Accepted: ', result.accept);
});
```

### Model

Droplet server maintains a number of named token buckets. Each token bucket represents an instance of a resource you want to enforce rate limits for. It can be an application, a user, an API, a database, etc. Each token bucket can be configured with a separate token limit for different time units: second, minute, hour, day, week, and month. When the droplet server starts, it does not contain any predefined token buckets. Token buckets and their limits can be created and configured or reconfigured dynamically after the droplet server has started. 

Droplet server exposes a request/response protocol over WebSockets. A *request* is a binary websocket message sent from the client to the server, and a *response* is a binary websocket message sent from the server to the client. Server processes requests and generates responses synchronously within a single websocket connection. This enables the client to implicitly correlate responses to requests using response order alone.

The [request](https://github.com/tjanczuk/droplet/blob/master/lib/droplet.proto) message is a Protocol Buffer binary message. A request identifies the named token bucket to remove tokens from. It specifies the rate limits that the server must set and use for the token bucket. It may specify the number of tokens to remove from the token bucket (by default 1). It may also request that any prior configuration of the named token bucket the server maintains to be deleted before the server applies the token bucket logic. 

For example, the client can specify the following request:

```javascript
{ bucket: 'foo', ls: 100, lm: 500 }
```

This request indicates that the client would like to remove 1 token from the token bucket named *foo* as long as the number of tokens associated with the per second (*ls*) and per minute (*lm*) limits are sufficient. Moreover, this request also informs the server to set the per second and per minute limits in the token bucket *foo* to 100 and 500, respectively. If the server does not maintain a token bucket *foo* yet, it will create one using these values. Otherwise it will reconfigure an existing token bucket *foo* to use these limits going forward. The limits specify how many tokens the server will be adding to the token bucket per specific unit of time. The *ls=100* value requires the server to add 100 tokens *every second* to the per-second balance associated with the *foo* token bucket. The balance of tokens per every period limit can never exceed the preconfigured limit for that period. Tokens are pro-rated on a millisecond basis. 

The server attempts to remove the specified number of tokens for every limit the request specifies in the named token bucket indicated by the request. Only if the number of tokens for every limit is sufficient will the operation succeed. 

The server responds to the client with a [response](https://github.com/tjanczuk/droplet/blob/master/lib/droplet.proto) message. The message indicates whether the request can be accepted or should be rejected due to insufficient amount of tokens. It also specifies the current number of tokens for the limits the client specified in the corresponding request.

A server response to the request above may look like this:

```javascript
{ accept: true, ls: 57, lm: 200 }
```

This indicates the request meets the rate requirements for the named token bucket. Current balance of tokens per second and per minute associated with the token bucket is 57 and 200, respectively. 

### Deployment

The droplet server maintains in-memory state and must be deployed as a singleton on a farm of servers that need to rate limit access to resources. Each of the application server in the farm acts as a droplet client and must establish a websocket connection to the droplet server. 

### Server

The droplet server is a zero-configuration server. The simplest way to start the server is to: 

```
npm install -g droplet 
droplet
```

This will start the droplet server listening for webosocket connections on port 3000. You can customize the port number with the `PORT` environment variable. 

The droplet Node.js module also offers a *create_server* function which can be used to further customize the droplet server: 

```javascript
var droplet = require('droplet');

var server = droplet.create_server({
    // required, websocket listen port
    port: 3000,

    // optional, bunyan logger; if not specified a default will be created
    logger: null,

    // optional, interval in seconds at which to review and remove token 
    // buckets that accumulated the number of tokens equal or exceeding the limit 
    // for each configured period; by default 60
    cleanup_interval: 60

}, function (error) {
    // server is listening unless error occurred
});
```

The return value of the *create_server* is an instance of the *ws.Server* from the [ws](https://github.com/websockets/ws) module. In addition to the *ws.Server* events, it also emits the *purge* event when a token bucket is removed from memory after having accummulated maximum allowed number of tokens across all periods:

```javascript
server.on('purge', function (bucket) {
    // bucket.name - name of token bucket that is removed
});
```

The droplet server maintains in-memory state. Restarts of the sever will cause this state to be lost. 

### Client

The Node.js client implements the droplet protocol. In addition it has a built-in server re-connect feature with exponential backoff and the ability to cache requests while the connection is under way.

This is how you create the client:

```javascript
var droplet = require('droplet');

var client = droplet.create_client({
    // required, the websocket URL to the droplet server, e.g. 'ws://foo.com:3000'
    url: null,

    // optional, bunyan logger; if not specified a default will be created
    logger: null,

    // optional, maximum server reconnect attempts; default 15
    max_reconnect: 15,

    // optional, delay for first reconnect attempt in ms; default 500ms
    reconnect_delay: 500,

    // optional, backoff multiplier for subsequent reconnect delays; default 1.2
    reconnect_delay_backoff: 1.2
});
```

The client is an [EventEmitter](https://nodejs.org/api/events.html#events_class_events_eventemitter). The only event it emits is `error`, after which the client is no longer usable. 

The primary function exposed by the droplet client is *take*:

```javascript
client.take({
    // required, name of the token bucket
    bucket: '',

    // required, request id (for logging only)
    id: '',

    // optional, tokens to remove (positive integer) 
    // or add (negative integer); default 1
    count: 1,

    // optional, whether to discard prior 
    // token bucket state; default false
    reset: false,

    // optional, per second quota of tokens; default undefined
    ls: 0,

    // optional, per minute quota of tokens; default undefined
    lm: 0,

    // optional, per hour quota of tokens; default undefined
    lh: 0,

    // optional, per day quota of tokens; default undefined
    ld: 0,

    // optional, per week quota of tokens; default undefined
    lw: 0,

    // optional, per month quota of tokens; default undefined
    lo: 0

}, function (error, result) {
    // error - error communicating with droplet server
    // result.accept == { true | false } - request satisfies rate limits
    // result.l{s|m|h|d|w|o} - current balance of tokens for a given period 
    //                         within the token bucket named in the request;
    //                         only periods listed in the request are set
});
```

The droplet client also exposes the *close* function which terminates the connection with the droplet server:

```javascript
client.close();
```

After *close* is called, the client is not usable.

### Protocol

In you want to use droplet with clients other than Node.js, you need to be able to establish an unsecure [WebSocket](http://en.wikipedia.org/wiki/WebSocket) connection with the droplet server and exchange binary websocket messages defined by the [Protocol Buffers](https://developers.google.com/protocol-buffers/) specification of [request and response](https://github.com/tjanczuk/droplet/blob/master/lib/droplet.proto). 

For every request the client sends to the droplet server, the client will receive a response message from the server. Order of responses corresponds to the order of request. 
#### Request

The [request](https://github.com/tjanczuk/droplet/blob/master/lib/droplet.proto) message semantic is as follows:

* *bucket* required; this is the token bucket name to apply rate limits to.  
* *id* required; arbitrary string for logging purposes that can be used for log correlation.  
* *count* optional; number of tokens to remove from the balance of the token bucket for every period; default 1.  
* *reset* optional; if *true*, the droplet server will forget any state associated with the named token bucket before applying token bucket logic; default false.  
* *ls* optional; per second token limit; default undefined.  
* *lm* optional; per minute token limit; default undefined.  
* *lh* optional; per hour token limit; default undefined.  
* *ld* optional; per day token limit; default undefined.  
* *lw* optional; per week token limit; default undefined.  
* *lo* optional; per month token limit default undefined.  

If the server has state associated with the token bucket named in the request, and the *reset* is set to *true*, the server will delete that state before any other processing.

If the server does not maintain any state for the token bucket named in the request, it will dynamically initialize it. 

The server will set new period limits for the named token bucket using values specified in *l{s|m|h|d|w|o}*. If the given limit had not been set before, the token balance associated with that period will be set to the value of the limit itself. If the limit had been set before, the balance remains unchanged. 

The server will attempt to establish the current balance of tokens for every period listed with the request. Only if the balance is larger or equal to *count* for every period listed in the request, the generated response will allow the request to proceed. 

If the request is allowed to proceed, the balance of tokens for every period configured in the named token bucket on the server (wich can be a superset of every period listed in the request) will be reduced the *count* amount. 

#### Response

The [response](https://github.com/tjanczuk/droplet/blob/master/lib/droplet.proto) message semantic is as follows:

* *accept* always present; true or false; indicates whether the reqeust satisfies the rate limits.  
* *l{s|m|h|d|w|o}* always present for the limits listed in the corresponding request; indicates the balance of tokens for respective time period within the named token bucket listed in the request.

## Tests

```
npm install
npm test
```

## Feedback

Please file all question and feedback [here](https://github.com/tjanczuk/droplet/issues). 