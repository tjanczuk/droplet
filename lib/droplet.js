var WebSocket = require('ws')
    , assert = require('assert')
    , path = require('path')
    , events = require('events')
    , ProtoBuf = require('protobufjs')
    , builder = ProtoBuf.loadProtoFile(path.join(__dirname, 'droplet.proto'))
    , Droplet = builder.build('Droplet')
    , Request = Droplet.Request
    , Response = Droplet.Response;

exports.create_token_bucket = function (options) {
    if (!options || typeof options != 'object')
        throw new Error('options must be specified');
    options.logger = options.logger || require('bunyan').createLogger({ name: 'droplet'});
    if (options.cleanup_interval === undefined)
        options.cleanup_interval = 60;

    var buckets = {};

    // Number of credits granted each millisecond per one unit of rate limit
    var credit_rate = {
        ls: 0.001,
        lm: 0.001 / 60,
        lh: 0.001 / 60 / 60,
        ld: 0.001 / 60 / 60 / 24,
        lw: 0.001 / 60 / 60 / 24 / 7,
        lo: 0.001 / 60 / 60 / 24 / 30
    };

    var limit_v = {}
        , limit_t = {};

    for (var limit in credit_rate) {
        limit_v[limit] = limit + '_v';
        limit_t[limit] = limit + '_t';
    }

    if (options.cleanup_interval > 0) {
        
        clean_one();

        function clean_one() {
            options.logger.info('start bucket GC');
            var now = Date.now();
            var remove = [];
            for (var id in buckets) {
                var bucket = buckets[id];
                var keep = false;
                for (var limit in credit_rate) {
                    var balance = bucket[limit_v[limit]];
                    if (balance !== undefined) {
                        balance += (now - bucket[limit_t[limit]]) * bucket[limit] * credit_rate[limit];
                        if (balance < bucket[limit]) {
                            keep = true;
                            break;
                        }
                    }
                }
                if (!keep)
                    remove.push(id);
            }
            remove.forEach(function (id) {
                options.logger.info({ bucket: id }, 'purging bucket with maxed out limits');
                options.wss && options.wss.emit('purge', buckets[id]);
                delete buckets[id];
            });
            options.logger.info({ removed_count: remove.length }, 'end bucket GC');

            setTimeout(clean_one, options.cleanup_interval * 1000).unref();
        }
    }

    return {
        take: function (request) {
            var now = Date.now();
            if (request.reset)
                delete buckets[request.bucket];
            var bucket = buckets[request.bucket];
            if (!bucket)
                bucket = buckets[request.bucket] = { name: request.bucket };

            var response = { accept: true };
            for (var limit in credit_rate) {
                var limitv = limit_v[limit]
                    , limitt = limit_t[limit];
                if (request[limit] > 0) {
                    // Enfore the limit.

                    // Store new limit
                    bucket[limit] = request[limit];
                    if (bucket[limitv] === undefined) {
                        // If limit is referred to for the first time, 
                        // set its initial value to the limit value and 
                        // store current time as last updated time.
                        bucket[limitv] = request[limit];
                        bucket[limitt] = now;
                    }

                    // Calculate credit for time elapsed
                    var credit = (now - bucket[limitt]) * bucket[limit] * credit_rate[limit];
                    if (credit > 100) {
                        // Add credit to value only when credit > 100
                        // to minimize compounding of rounding errors.
                        bucket[limitv] = Math.min(bucket[limitv] + credit, bucket[limit]);
                        bucket[limitt] = now;
                        credit = 0;
                    }

                    // Check if balance allows the request to pass
                    var balance = bucket[limitv] + credit - request.count;
                    response[limit] = Math.floor(Math.min(balance, bucket[limit]));
                    if (response.accept && balance < 0) 
                        response.accept = false;
                }
            }

            if (response.accept) {
                // Debit tokens from every configured limit in the bucket
                for (var limit in credit_rate) {
                    if (bucket[limit] !== undefined)
                        bucket[limit_v[limit]] -= request.count;
                }
            }

            return response;
        },

        query: function (request) {
            var now = Date.now();
            var bucket = buckets[request.bucket];
            var response = { accept: true };

            if (bucket) {
                for (var limit in credit_rate) {
                    var v = bucket[limit_v[limit]];
                    if (v !== undefined) {
                        v += (now - bucket[limit_t[limit]]) * bucket[limit] * credit_rate[limit];
                        response[limit] = Math.floor(Math.min(v, bucket[limit]));
                    }
                }
            }

            return response;
        }
    };
};

exports.create_server = function (options, callback) {
    if (!options || typeof options != 'object')
        throw new Error('options must be specified');

    options.logger = options.logger || require('bunyan').createLogger({ name: 'droplet'});

    var wss = options.wss = new WebSocket.Server({ port: options.port }, callback);
    var buckets = exports.create_token_bucket(options);

    wss.on('connection', function (ws) {
        options.logger.info('new connection');
        ws.on('message', function (data, flags) {
            if (!flags.binary) {
                safe_close();
                return options.logger.warn({ message: data }, 'invalid non-binary request, closing connection');
            }
            try {
                data = Request.decode(data);
            }
            catch (e1) {
                safe_close();
                return options.logger.warn(e1, 'error decoding binary request, closing connection');
            }
            options.logger.info({ id: data.id, bucket: data.bucket, type: data.type }, 'received request');
            var response = data.type === Request.Type.TAKE ? buckets.take(data) : buckets.query(data);
            var pbResponse = new Response(response);
            if (data.type === Request.Type.QUERY)
                options.logger.info(response, 'sending query response');
            if (response.accept)
                options.logger.info(response, 'sending accept response');
            else
                options.logger.warn(response, 'sending reject response');
            try {
                ws.send(pbResponse.encode().toBuffer());
            }
            catch (e2) {
                return options.logger.warn({ 
                    id: data.id, 
                    error: (e2.message || JSON.stringify(e2))
                }, 'error sending response');
            }
        });
        ws.on('error', function (error) {
            options.logger.warn(error, 'websocket connection error');
            safe_close();
        });

        function safe_close() {
            try {
                ws.close();
            }
            catch (e) {}
        }
    });

    return wss;
};


exports.create_client = function (options) {
    if (!options || typeof options != 'object')
        throw new Error('options must be specified');
    if (typeof options.url != 'string')
        throw new Error('options.url must be specified');

    options.logger = options.logger || require('bunyan').createLogger({ name: 'droplet'});
    options.max_reconnect = options.max_reconnect || 15;
    options.reconnect_delay = options.reconnect_delay || 500;
    options.reconnect_delay_backoff = options.reconnect_delay_backoff || 1.2;

    var client = new events.EventEmitter();

    client.reconnect_attempt = options.max_reconnect;
    client.reconnect_delay = options.reconnect_delay;
    client.pending_reqs = [];
    client.sent_reqs = [];

    client.take = function (payload, callback) {
        if (client.closed)
            throw new Error('Droplet client has been closed');
        client.pending_reqs.push({ payload: payload, callback: callback });
        if (client.ws) 
            send_now();
    };

    client.query = function (payload, callback) {
        if (client.closed)
            throw new Error('Droplet client has been closed');
        payload.type = Request.Type.QUERY;
        client.pending_reqs.push({ payload: payload, callback: function (error, result) {
            if (result) delete result.accept;
            callback && callback(error, result);
        }});
        if (client.ws) 
            send_now();        
    };

    client.close = function () {
        if (client.ws) {
            client.closed = true;
            try {
                client.ws.close();
            }
            catch (e) {}
            client.ws = undefined;
        }
    };

    connect();

    return client;

    function send_now() {
        while (client.pending_reqs.length > 0) {
            var req = client.pending_reqs.shift();        
            var error;
            try {
                var pb = new Request(req.payload);
                client.ws.send(pb.encode().toBuffer(), { binary: true }, (function (req) { 
                    return function (err) {
                        if (err) {
                            options.logger.warn(err, 'droplet websocket send async error');
                            req.callback && req.callback(err);
                        }
                        else 
                            client.sent_reqs.push(req);
                    }
                })(req));
            }
            catch (e) {
                error = e;
            }
            if (error) {
                options.logger.warn(error, 'droplet websocket send sync error');
                req.callback && req.callback(error);
            }
        }
    }

    function connect() {
        var ws, error;
        try {
            ws = new WebSocket(options.url);
        }
        catch (e) {
            error = e;
        }
        if (error) {
            options.logger.warn(error, 'droplet websocket client unable to connect');
            return try_reconnect();
        }

        ws.on('open', function () {
            options.logger.info({ 
                after_attempts: options.max_reconnect - client.reconnect_attempt + 1,
                attempts_left: client.reconnect_attempt - 1
            }, 'droplet websocket client connected');
            client.reconnect_attempt = options.max_reconnect;
            client.reconnect_delay = options.reconnect_delay;
            client.ws = ws;
            send_now();
        });

        ws.on('error', function (error) {
            options.logger.warn(error, 'droplet websocket client error');
            fail_reqs(error);
            if (!client.closed)
                setImmediate(try_reconnect);
        });

        ws.on('close', function () {
            if (!client.closed)
                setImmediate(try_reconnect);
        });

        ws.on('message', function (data, flags) {
            var req = client.sent_reqs.shift();
            if (!req) {
                fail_reqs();
                options.logger.error('received message from droplet server without corresponding request');
                return ws.close();
            }
            if (!flags.binary) {
                var msg = 'received non-binary response from droplet server'
                req.callback && req.callback(error);
                fail_reqs();
                options.logger.error({ id: req.payload.id, message: data }, msg);
                return ws.close();
            }
            var error;
            try {
                data = Response.decode(data);
            }
            catch (e) {
                error = e;
            }
            if (error) {
                req.callback && req.callback(error);
                fail_reqs();
                options.logger.error({ id: req.payload.id, error: (error.message || JSON.stringify(error)) }, 
                    'binary response from droplet server cannot be decoded');
                ws.close();
                return try_reconnect();
            }
            var log_data = { id: req.payload.id };
            for (var p in data)
                if (data[p] !== null && typeof data[p] !== 'object')
                    log_data[p] = data[p];
            options.logger.info(log_data, 'response from droplet server');
            req.callback && req.callback(null, data);
        });

        function fail_reqs(error) {
            while (client.sent_reqs.length > 0) {
                var req = client.sent_reqs.shift();
                req.callback && req.callback(error);
            }
            while (client.pending_reqs.length > 0) {
                var req = client.pending_reqs.shift();
                req.callback && req.callback(error);
            }
        }

        function try_reconnect() {
            if (client.reconnect_attempt <= 0) {
                client.closed = true;
                options.logger.error({ attempts: options.max_reconnect }, 'exceeded max reconnect attempts');
                return client.emit('error', 
                    new Error('Droplet client exceeded max reconnect attempts of ' + options.max_reconnect));
            }
            client.reconnect_attempt--;
            client.reconnect_delay = Math.floor(client.reconnect_delay * options.reconnect_delay_backoff);
            options.logger.warn({ attempt: client.reconnect_attempt, delay: client.reconnect_delay },
                'error connecting to server; backing off before retry');
            setTimeout(connect, client.reconnect_delay);
        }
    }

};