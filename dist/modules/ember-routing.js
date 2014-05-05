(function() {
define("route-recognizer",
  ["exports"],
  function(__exports__) {
    "use strict";
    var specials = [
      '/', '.', '*', '+', '?', '|',
      '(', ')', '[', ']', '{', '}', '\\'
    ];

    var escapeRegex = new RegExp('(\\' + specials.join('|\\') + ')', 'g');

    function isArray(test) {
      return Object.prototype.toString.call(test) === "[object Array]";
    }

    // A Segment represents a segment in the original route description.
    // Each Segment type provides an `eachChar` and `regex` method.
    //
    // The `eachChar` method invokes the callback with one or more character
    // specifications. A character specification consumes one or more input
    // characters.
    //
    // The `regex` method returns a regex fragment for the segment. If the
    // segment is a dynamic of star segment, the regex fragment also includes
    // a capture.
    //
    // A character specification contains:
    //
    // * `validChars`: a String with a list of all valid characters, or
    // * `invalidChars`: a String with a list of all invalid characters
    // * `repeat`: true if the character specification can repeat

    function StaticSegment(string) { this.string = string; }
    StaticSegment.prototype = {
      eachChar: function(callback) {
        var string = this.string, ch;

        for (var i=0, l=string.length; i<l; i++) {
          ch = string.charAt(i);
          callback({ validChars: ch });
        }
      },

      regex: function() {
        return this.string.replace(escapeRegex, '\\$1');
      },

      generate: function() {
        return this.string;
      }
    };

    function DynamicSegment(name) { this.name = name; }
    DynamicSegment.prototype = {
      eachChar: function(callback) {
        callback({ invalidChars: "/", repeat: true });
      },

      regex: function() {
        return "([^/]+)";
      },

      generate: function(params) {
        return params[this.name];
      }
    };

    function StarSegment(name) { this.name = name; }
    StarSegment.prototype = {
      eachChar: function(callback) {
        callback({ invalidChars: "", repeat: true });
      },

      regex: function() {
        return "(.+)";
      },

      generate: function(params) {
        return params[this.name];
      }
    };

    function EpsilonSegment() {}
    EpsilonSegment.prototype = {
      eachChar: function() {},
      regex: function() { return ""; },
      generate: function() { return ""; }
    };

    function parse(route, names, types) {
      // normalize route as not starting with a "/". Recognition will
      // also normalize.
      if (route.charAt(0) === "/") { route = route.substr(1); }

      var segments = route.split("/"), results = [];

      for (var i=0, l=segments.length; i<l; i++) {
        var segment = segments[i], match;

        if (match = segment.match(/^:([^\/]+)$/)) {
          results.push(new DynamicSegment(match[1]));
          names.push(match[1]);
          types.dynamics++;
        } else if (match = segment.match(/^\*([^\/]+)$/)) {
          results.push(new StarSegment(match[1]));
          names.push(match[1]);
          types.stars++;
        } else if(segment === "") {
          results.push(new EpsilonSegment());
        } else {
          results.push(new StaticSegment(segment));
          types.statics++;
        }
      }

      return results;
    }

    // A State has a character specification and (`charSpec`) and a list of possible
    // subsequent states (`nextStates`).
    //
    // If a State is an accepting state, it will also have several additional
    // properties:
    //
    // * `regex`: A regular expression that is used to extract parameters from paths
    //   that reached this accepting state.
    // * `handlers`: Information on how to convert the list of captures into calls
    //   to registered handlers with the specified parameters
    // * `types`: How many static, dynamic or star segments in this route. Used to
    //   decide which route to use if multiple registered routes match a path.
    //
    // Currently, State is implemented naively by looping over `nextStates` and
    // comparing a character specification against a character. A more efficient
    // implementation would use a hash of keys pointing at one or more next states.

    function State(charSpec) {
      this.charSpec = charSpec;
      this.nextStates = [];
    }

    State.prototype = {
      get: function(charSpec) {
        var nextStates = this.nextStates;

        for (var i=0, l=nextStates.length; i<l; i++) {
          var child = nextStates[i];

          var isEqual = child.charSpec.validChars === charSpec.validChars;
          isEqual = isEqual && child.charSpec.invalidChars === charSpec.invalidChars;

          if (isEqual) { return child; }
        }
      },

      put: function(charSpec) {
        var state;

        // If the character specification already exists in a child of the current
        // state, just return that state.
        if (state = this.get(charSpec)) { return state; }

        // Make a new state for the character spec
        state = new State(charSpec);

        // Insert the new state as a child of the current state
        this.nextStates.push(state);

        // If this character specification repeats, insert the new state as a child
        // of itself. Note that this will not trigger an infinite loop because each
        // transition during recognition consumes a character.
        if (charSpec.repeat) {
          state.nextStates.push(state);
        }

        // Return the new state
        return state;
      },

      // Find a list of child states matching the next character
      match: function(ch) {
        // DEBUG "Processing `" + ch + "`:"
        var nextStates = this.nextStates,
            child, charSpec, chars;

        // DEBUG "  " + debugState(this)
        var returned = [];

        for (var i=0, l=nextStates.length; i<l; i++) {
          child = nextStates[i];

          charSpec = child.charSpec;

          if (typeof (chars = charSpec.validChars) !== 'undefined') {
            if (chars.indexOf(ch) !== -1) { returned.push(child); }
          } else if (typeof (chars = charSpec.invalidChars) !== 'undefined') {
            if (chars.indexOf(ch) === -1) { returned.push(child); }
          }
        }

        return returned;
      }

      /** IF DEBUG
      , debug: function() {
        var charSpec = this.charSpec,
            debug = "[",
            chars = charSpec.validChars || charSpec.invalidChars;

        if (charSpec.invalidChars) { debug += "^"; }
        debug += chars;
        debug += "]";

        if (charSpec.repeat) { debug += "+"; }

        return debug;
      }
      END IF **/
    };

    /** IF DEBUG
    function debug(log) {
      console.log(log);
    }

    function debugState(state) {
      return state.nextStates.map(function(n) {
        if (n.nextStates.length === 0) { return "( " + n.debug() + " [accepting] )"; }
        return "( " + n.debug() + " <then> " + n.nextStates.map(function(s) { return s.debug() }).join(" or ") + " )";
      }).join(", ")
    }
    END IF **/

    // This is a somewhat naive strategy, but should work in a lot of cases
    // A better strategy would properly resolve /posts/:id/new and /posts/edit/:id.
    //
    // This strategy generally prefers more static and less dynamic matching.
    // Specifically, it
    //
    //  * prefers fewer stars to more, then
    //  * prefers using stars for less of the match to more, then
    //  * prefers fewer dynamic segments to more, then
    //  * prefers more static segments to more
    function sortSolutions(states) {
      return states.sort(function(a, b) {
        if (a.types.stars !== b.types.stars) { return a.types.stars - b.types.stars; }

        if (a.types.stars) {
          if (a.types.statics !== b.types.statics) { return b.types.statics - a.types.statics; }
          if (a.types.dynamics !== b.types.dynamics) { return b.types.dynamics - a.types.dynamics; }
        }

        if (a.types.dynamics !== b.types.dynamics) { return a.types.dynamics - b.types.dynamics; }
        if (a.types.statics !== b.types.statics) { return b.types.statics - a.types.statics; }

        return 0;
      });
    }

    function recognizeChar(states, ch) {
      var nextStates = [];

      for (var i=0, l=states.length; i<l; i++) {
        var state = states[i];

        nextStates = nextStates.concat(state.match(ch));
      }

      return nextStates;
    }

    var oCreate = Object.create || function(proto) {
      function F() {}
      F.prototype = proto;
      return new F();
    };

    function RecognizeResults(queryParams) {
      this.queryParams = queryParams || {};
    }
    RecognizeResults.prototype = oCreate({
      splice: Array.prototype.splice,
      slice:  Array.prototype.slice,
      push:   Array.prototype.push,
      length: 0,
      queryParams: null
    });

    function findHandler(state, path, queryParams) {
      var handlers = state.handlers, regex = state.regex;
      var captures = path.match(regex), currentCapture = 1;
      var result = new RecognizeResults(queryParams);

      for (var i=0, l=handlers.length; i<l; i++) {
        var handler = handlers[i], names = handler.names, params = {};

        for (var j=0, m=names.length; j<m; j++) {
          params[names[j]] = captures[currentCapture++];
        }

        result.push({ handler: handler.handler, params: params, isDynamic: !!names.length });
      }

      return result;
    }

    function addSegment(currentState, segment) {
      segment.eachChar(function(ch) {
        var state;

        currentState = currentState.put(ch);
      });

      return currentState;
    }

    // The main interface

    var RouteRecognizer = function() {
      this.rootState = new State();
      this.names = {};
    };


    RouteRecognizer.prototype = {
      add: function(routes, options) {
        var currentState = this.rootState, regex = "^",
            types = { statics: 0, dynamics: 0, stars: 0 },
            handlers = [], allSegments = [], name;

        var isEmpty = true;

        for (var i=0, l=routes.length; i<l; i++) {
          var route = routes[i], names = [];

          var segments = parse(route.path, names, types);

          allSegments = allSegments.concat(segments);

          for (var j=0, m=segments.length; j<m; j++) {
            var segment = segments[j];

            if (segment instanceof EpsilonSegment) { continue; }

            isEmpty = false;

            // Add a "/" for the new segment
            currentState = currentState.put({ validChars: "/" });
            regex += "/";

            // Add a representation of the segment to the NFA and regex
            currentState = addSegment(currentState, segment);
            regex += segment.regex();
          }

          var handler = { handler: route.handler, names: names };
          handlers.push(handler);
        }

        if (isEmpty) {
          currentState = currentState.put({ validChars: "/" });
          regex += "/";
        }

        currentState.handlers = handlers;
        currentState.regex = new RegExp(regex + "$");
        currentState.types = types;

        if (name = options && options.as) {
          this.names[name] = {
            segments: allSegments,
            handlers: handlers
          };
        }
      },

      handlersFor: function(name) {
        var route = this.names[name], result = [];
        if (!route) { throw new Error("There is no route named " + name); }

        for (var i=0, l=route.handlers.length; i<l; i++) {
          result.push(route.handlers[i]);
        }

        return result;
      },

      hasRoute: function(name) {
        return !!this.names[name];
      },

      generate: function(name, params) {
        var route = this.names[name], output = "";
        if (!route) { throw new Error("There is no route named " + name); }

        var segments = route.segments;

        for (var i=0, l=segments.length; i<l; i++) {
          var segment = segments[i];

          if (segment instanceof EpsilonSegment) { continue; }

          output += "/";
          output += segment.generate(params);
        }

        if (output.charAt(0) !== '/') { output = '/' + output; }

        if (params && params.queryParams) {
          output += this.generateQueryString(params.queryParams, route.handlers);
        }

        return output;
      },

      generateQueryString: function(params, handlers) {
        var pairs = [];
        var keys = [];
        for(var key in params) {
          if (params.hasOwnProperty(key)) {
            keys.push(key);
          }
        }
        keys.sort();
        for (var i = 0, len = keys.length; i < len; i++) {
          key = keys[i];
          var value = params[key];
          if (value === false || value == null) {
            continue;
          }
          var pair = key;
          if (isArray(value)) {
            for (var j = 0, l = value.length; j < l; j++) {
              var arrayPair = key + '[]' + '=' + encodeURIComponent(value[j]);
              pairs.push(arrayPair);
            }
          }
          else if (value !== true) {
            pair += "=" + encodeURIComponent(value);
            pairs.push(pair);
          } else {
            pairs.push(pair);
          }
        }

        if (pairs.length === 0) { return ''; }

        return "?" + pairs.join("&");
      },

      parseQueryString: function(queryString) {
        var pairs = queryString.split("&"), queryParams = {};
        for(var i=0; i < pairs.length; i++) {
          var pair      = pairs[i].split('='),
              key       = decodeURIComponent(pair[0]),
              keyLength = key.length,
              isArray = false,
              value;
          if (pair.length === 1) {
            value = true;
          } else {
            //Handle arrays
            if (keyLength > 2 && key.slice(keyLength -2) === '[]') {
              isArray = true;
              key = key.slice(0, keyLength - 2);
              if(!queryParams[key]) {
                queryParams[key] = [];
              }
            }
            value = pair[1] ? decodeURIComponent(pair[1]) : '';
          }
          if (isArray) {
            queryParams[key].push(value);
          } else {
            queryParams[key] = value;
          }

        }
        return queryParams;
      },

      recognize: function(path) {
        var states = [ this.rootState ],
            pathLen, i, l, queryStart, queryParams = {},
            isSlashDropped = false;

        path = decodeURI(path);

        queryStart = path.indexOf('?');
        if (queryStart !== -1) {
          var queryString = path.substr(queryStart + 1, path.length);
          path = path.substr(0, queryStart);
          queryParams = this.parseQueryString(queryString);
        }

        // DEBUG GROUP path

        if (path.charAt(0) !== "/") { path = "/" + path; }

        pathLen = path.length;
        if (pathLen > 1 && path.charAt(pathLen - 1) === "/") {
          path = path.substr(0, pathLen - 1);
          isSlashDropped = true;
        }

        for (i=0, l=path.length; i<l; i++) {
          states = recognizeChar(states, path.charAt(i));
          if (!states.length) { break; }
        }

        // END DEBUG GROUP

        var solutions = [];
        for (i=0, l=states.length; i<l; i++) {
          if (states[i].handlers) { solutions.push(states[i]); }
        }

        states = sortSolutions(solutions);

        var state = solutions[0];

        if (state && state.handlers) {
          // if a trailing slash was dropped and a star segment is the last segment
          // specified, put the trailing slash back
          if (isSlashDropped && state.regex.source.slice(-5) === "(.+)$") {
            path = path + "/";
          }
          return findHandler(state, path, queryParams);
        }
      }
    };

    __exports__["default"] = RouteRecognizer;

    function Target(path, matcher, delegate) {
      this.path = path;
      this.matcher = matcher;
      this.delegate = delegate;
    }

    Target.prototype = {
      to: function(target, callback) {
        var delegate = this.delegate;

        if (delegate && delegate.willAddRoute) {
          target = delegate.willAddRoute(this.matcher.target, target);
        }

        this.matcher.add(this.path, target);

        if (callback) {
          if (callback.length === 0) { throw new Error("You must have an argument in the function passed to `to`"); }
          this.matcher.addChild(this.path, target, callback, this.delegate);
        }
        return this;
      }
    };

    function Matcher(target) {
      this.routes = {};
      this.children = {};
      this.target = target;
    }

    Matcher.prototype = {
      add: function(path, handler) {
        this.routes[path] = handler;
      },

      addChild: function(path, target, callback, delegate) {
        var matcher = new Matcher(target);
        this.children[path] = matcher;

        var match = generateMatch(path, matcher, delegate);

        if (delegate && delegate.contextEntered) {
          delegate.contextEntered(target, match);
        }

        callback(match);
      }
    };

    function generateMatch(startingPath, matcher, delegate) {
      return function(path, nestedCallback) {
        var fullPath = startingPath + path;

        if (nestedCallback) {
          nestedCallback(generateMatch(fullPath, matcher, delegate));
        } else {
          return new Target(startingPath + path, matcher, delegate);
        }
      };
    }

    function addRoute(routeArray, path, handler) {
      var len = 0;
      for (var i=0, l=routeArray.length; i<l; i++) {
        len += routeArray[i].path.length;
      }

      path = path.substr(len);
      var route = { path: path, handler: handler };
      routeArray.push(route);
    }

    function eachRoute(baseRoute, matcher, callback, binding) {
      var routes = matcher.routes;

      for (var path in routes) {
        if (routes.hasOwnProperty(path)) {
          var routeArray = baseRoute.slice();
          addRoute(routeArray, path, routes[path]);

          if (matcher.children[path]) {
            eachRoute(routeArray, matcher.children[path], callback, binding);
          } else {
            callback.call(binding, routeArray);
          }
        }
      }
    }

    RouteRecognizer.prototype.map = function(callback, addRouteCallback) {
      var matcher = new Matcher();

      callback(generateMatch("", matcher, this.delegate));

      eachRoute([], matcher, function(route) {
        if (addRouteCallback) { addRouteCallback(this, route); }
        else { this.add(route); }
      }, this);
    };
  });

})();



(function() {
define("router/handler-info", 
  ["./utils","rsvp","exports"],
  function(__dependency1__, __dependency2__, __exports__) {
    "use strict";
    var bind = __dependency1__.bind;
    var merge = __dependency1__.merge;
    var oCreate = __dependency1__.oCreate;
    var serialize = __dependency1__.serialize;
    var promiseLabel = __dependency1__.promiseLabel;
    var resolve = __dependency2__.resolve;

    function HandlerInfo(props) {
      if (props) {
        merge(this, props);
      }
    }

    HandlerInfo.prototype = {
      name: null,
      handler: null,
      params: null,
      context: null,

      log: function(payload, message) {
        if (payload.log) {
          payload.log(this.name + ': ' + message);
        }
      },

      promiseLabel: function(label) {
        return promiseLabel("'" + this.name + "' " + label);
      },

      resolve: function(async, shouldContinue, payload) {
        var checkForAbort  = bind(this.checkForAbort,      this, shouldContinue),
            beforeModel    = bind(this.runBeforeModelHook, this, async, payload),
            model          = bind(this.getModel,           this, async, payload),
            afterModel     = bind(this.runAfterModelHook,  this, async, payload),
            becomeResolved = bind(this.becomeResolved,     this, payload);

        return resolve(undefined, this.promiseLabel("Start handler"))
               .then(checkForAbort, null, this.promiseLabel("Check for abort"))
               .then(beforeModel, null, this.promiseLabel("Before model"))
               .then(checkForAbort, null, this.promiseLabel("Check if aborted during 'beforeModel' hook"))
               .then(model, null, this.promiseLabel("Model"))
               .then(checkForAbort, null, this.promiseLabel("Check if aborted in 'model' hook"))
               .then(afterModel, null, this.promiseLabel("After model"))
               .then(checkForAbort, null, this.promiseLabel("Check if aborted in 'afterModel' hook"))
               .then(becomeResolved, null, this.promiseLabel("Become resolved"));
      },

      runBeforeModelHook: function(async, payload) {
        if (payload.trigger) {
          payload.trigger(true, 'willResolveModel', payload, this.handler);
        }
        return this.runSharedModelHook(async, payload, 'beforeModel', []);
      },

      runAfterModelHook: function(async, payload, resolvedModel) {
        // Stash the resolved model on the payload.
        // This makes it possible for users to swap out
        // the resolved model in afterModel.
        var name = this.name;
        this.stashResolvedModel(payload, resolvedModel);

        return this.runSharedModelHook(async, payload, 'afterModel', [resolvedModel])
                   .then(function() {
                     // Ignore the fulfilled value returned from afterModel.
                     // Return the value stashed in resolvedModels, which
                     // might have been swapped out in afterModel.
                     return payload.resolvedModels[name];
                   }, null, this.promiseLabel("Ignore fulfillment value and return model value"));
      },

      runSharedModelHook: function(async, payload, hookName, args) {
        this.log(payload, "calling " + hookName + " hook");

        if (this.queryParams) {
          args.push(this.queryParams);
        }
        args.push(payload);

        var handler = this.handler;
        return async(function() {
          return handler[hookName] && handler[hookName].apply(handler, args);
        }, this.promiseLabel("Handle " + hookName));
      },

      getModel: function(payload) {
        throw new Error("This should be overridden by a subclass of HandlerInfo");
      },

      checkForAbort: function(shouldContinue, promiseValue) {
        return resolve(shouldContinue(), this.promiseLabel("Check for abort")).then(function() {
          // We don't care about shouldContinue's resolve value;
          // pass along the original value passed to this fn.
          return promiseValue;
        }, null, this.promiseLabel("Ignore fulfillment value and continue"));
      },

      stashResolvedModel: function(payload, resolvedModel) {
        payload.resolvedModels = payload.resolvedModels || {};
        payload.resolvedModels[this.name] = resolvedModel;
      },

      becomeResolved: function(payload, resolvedContext) {
        var params = this.params || serialize(this.handler, resolvedContext, this.names);

        if (payload) {
          this.stashResolvedModel(payload, resolvedContext);
          payload.params = payload.params || {};
          payload.params[this.name] = params;
        }

        return new ResolvedHandlerInfo({
          context: resolvedContext,
          name: this.name,
          handler: this.handler,
          params: params
        });
      },

      shouldSupercede: function(other) {
        // Prefer this newer handlerInfo over `other` if:
        // 1) The other one doesn't exist
        // 2) The names don't match
        // 3) This handler has a context that doesn't match
        //    the other one (or the other one doesn't have one).
        // 4) This handler has parameters that don't match the other.
        if (!other) { return true; }

        var contextsMatch = (other.context === this.context);
        return other.name !== this.name ||
               (this.hasOwnProperty('context') && !contextsMatch) ||
               (this.hasOwnProperty('params') && !paramsMatch(this.params, other.params));
      }
    };

    function ResolvedHandlerInfo(props) {
      HandlerInfo.call(this, props);
    }

    ResolvedHandlerInfo.prototype = oCreate(HandlerInfo.prototype);
    ResolvedHandlerInfo.prototype.resolve = function(async, shouldContinue, payload) {
      // A ResolvedHandlerInfo just resolved with itself.
      if (payload && payload.resolvedModels) {
        payload.resolvedModels[this.name] = this.context;
      }
      return resolve(this, this.promiseLabel("Resolve"));
    };

    // These are generated by URL transitions and
    // named transitions for non-dynamic route segments.
    function UnresolvedHandlerInfoByParam(props) {
      HandlerInfo.call(this, props);
      this.params = this.params || {};
    }

    UnresolvedHandlerInfoByParam.prototype = oCreate(HandlerInfo.prototype);
    UnresolvedHandlerInfoByParam.prototype.getModel = function(async, payload) {
      var fullParams = this.params;
      if (payload && payload.queryParams) {
        fullParams = {};
        merge(fullParams, this.params);
        fullParams.queryParams = payload.queryParams;
      }

      var hookName = typeof this.handler.deserialize === 'function' ?
                     'deserialize' : 'model';

      return this.runSharedModelHook(async, payload, hookName, [fullParams]);
    };


    // These are generated only for named transitions
    // with dynamic route segments.
    function UnresolvedHandlerInfoByObject(props) {
      HandlerInfo.call(this, props);
    }

    UnresolvedHandlerInfoByObject.prototype = oCreate(HandlerInfo.prototype);
    UnresolvedHandlerInfoByObject.prototype.getModel = function(async, payload) {
      this.log(payload, this.name + ": resolving provided model");
      return resolve(this.context);
    };

    function paramsMatch(a, b) {
      if ((!a) ^ (!b)) {
        // Only one is null.
        return false;
      }

      if (!a) {
        // Both must be null.
        return true;
      }

      // Note: this assumes that both params have the same
      // number of keys, but since we're comparing the
      // same handlers, they should.
      for (var k in a) {
        if (a.hasOwnProperty(k) && a[k] !== b[k]) {
          return false;
        }
      }
      return true;
    }

    __exports__.HandlerInfo = HandlerInfo;
    __exports__.ResolvedHandlerInfo = ResolvedHandlerInfo;
    __exports__.UnresolvedHandlerInfoByParam = UnresolvedHandlerInfoByParam;
    __exports__.UnresolvedHandlerInfoByObject = UnresolvedHandlerInfoByObject;
  });
define("router/router", 
  ["route-recognizer","rsvp","./utils","./transition-state","./transition","./transition-intent/named-transition-intent","./transition-intent/url-transition-intent","exports"],
  function(__dependency1__, __dependency2__, __dependency3__, __dependency4__, __dependency5__, __dependency6__, __dependency7__, __exports__) {
    "use strict";
    var RouteRecognizer = __dependency1__["default"];
    var resolve = __dependency2__.resolve;
    var reject = __dependency2__.reject;
    var async = __dependency2__.async;
    var Promise = __dependency2__.Promise;
    var trigger = __dependency3__.trigger;
    var log = __dependency3__.log;
    var slice = __dependency3__.slice;
    var forEach = __dependency3__.forEach;
    var merge = __dependency3__.merge;
    var serialize = __dependency3__.serialize;
    var extractQueryParams = __dependency3__.extractQueryParams;
    var getChangelist = __dependency3__.getChangelist;
    var promiseLabel = __dependency3__.promiseLabel;
    var TransitionState = __dependency4__.TransitionState;
    var logAbort = __dependency5__.logAbort;
    var Transition = __dependency5__.Transition;
    var TransitionAborted = __dependency5__.TransitionAborted;
    var NamedTransitionIntent = __dependency6__.NamedTransitionIntent;
    var URLTransitionIntent = __dependency7__.URLTransitionIntent;

    var pop = Array.prototype.pop;

    function Router() {
      this.recognizer = new RouteRecognizer();
      this.reset();
    }

    Router.prototype = {

      /**
        The main entry point into the router. The API is essentially
        the same as the `map` method in `route-recognizer`.

        This method extracts the String handler at the last `.to()`
        call and uses it as the name of the whole route.

        @param {Function} callback
      */
      map: function(callback) {
        this.recognizer.delegate = this.delegate;

        this.recognizer.map(callback, function(recognizer, routes) {
          for (var i = routes.length - 1, proceed = true; i >= 0 && proceed; --i) {
            var route = routes[i];
            recognizer.add(routes, { as: route.handler });
            proceed = route.path === '/' || route.path === '' || route.handler.slice(-6) === '.index';
          }
        });
      },

      hasRoute: function(route) {
        return this.recognizer.hasRoute(route);
      },

      // NOTE: this doesn't really belong here, but here
      // it shall remain until our ES6 transpiler can
      // handle cyclical deps.
      transitionByIntent: function(intent, isIntermediate) {

        var wasTransitioning = !!this.activeTransition;
        var oldState = wasTransitioning ? this.activeTransition.state : this.state;
        var newTransition;
        var router = this;

        try {
          var newState = intent.applyToState(oldState, this.recognizer, this.getHandler, isIntermediate);

          if (handlerInfosEqual(newState.handlerInfos, oldState.handlerInfos)) {

            // This is a no-op transition. See if query params changed.
            var queryParamChangelist = getChangelist(oldState.queryParams, newState.queryParams);
            if (queryParamChangelist) {

              // This is a little hacky but we need some way of storing
              // changed query params given that no activeTransition
              // is guaranteed to have occurred.
              this._changedQueryParams = queryParamChangelist.changed;
              trigger(this, newState.handlerInfos, true, ['queryParamsDidChange', queryParamChangelist.changed, queryParamChangelist.all, queryParamChangelist.removed]);
              this._changedQueryParams = null;

              if (!wasTransitioning && this.activeTransition) {
                // One of the handlers in queryParamsDidChange
                // caused a transition. Just return that transition.
                return this.activeTransition;
              } else {
                // Running queryParamsDidChange didn't change anything.
                // Just update query params and be on our way.
                oldState.queryParams = finalizeQueryParamChange(this, newState.handlerInfos, newState.queryParams);

                // We have to return a noop transition that will
                // perform a URL update at the end. This gives
                // the user the ability to set the url update
                // method (default is replaceState).
                newTransition = new Transition(this);
                newTransition.urlMethod = 'replace';
                newTransition.promise = newTransition.promise.then(function(result) {
                  updateURL(newTransition, oldState, true);
                  if (router.didTransition) {
                    router.didTransition(router.currentHandlerInfos);
                  }
                  return result;
                }, null, promiseLabel("Transition complete"));
                return newTransition;
              }
            }

            // No-op. No need to create a new transition.
            return new Transition(this);
          }

          if (isIntermediate) {
            setupContexts(this, newState);
            return;
          }

          // Create a new transition to the destination route.
          newTransition = new Transition(this, intent, newState);

          // Abort and usurp any previously active transition.
          if (this.activeTransition) {
            this.activeTransition.abort();
          }
          this.activeTransition = newTransition;

          // Transition promises by default resolve with resolved state.
          // For our purposes, swap out the promise to resolve
          // after the transition has been finalized.
          newTransition.promise = newTransition.promise.then(function(result) {
            return router.async(function() {
              return finalizeTransition(newTransition, result.state);
            }, "Finalize transition");
          }, null, promiseLabel("Settle transition promise when transition is finalized"));

          if (!wasTransitioning) {
            trigger(this, this.state.handlerInfos, true, ['willTransition', newTransition]);
          }

          return newTransition;
        } catch(e) {
          return new Transition(this, intent, null, e);
        }
      },

      /**
        Clears the current and target route handlers and triggers exit
        on each of them starting at the leaf and traversing up through
        its ancestors.
      */
      reset: function() {
        if (this.state) {
          forEach(this.state.handlerInfos, function(handlerInfo) {
            var handler = handlerInfo.handler;
            if (handler.exit) {
              handler.exit();
            }
          });
        }

        this.state = new TransitionState();
        this.currentHandlerInfos = null;
      },

      activeTransition: null,

      /**
        var handler = handlerInfo.handler;
        The entry point for handling a change to the URL (usually
        via the back and forward button).

        Returns an Array of handlers and the parameters associated
        with those parameters.

        @param {String} url a URL to process

        @return {Array} an Array of `[handler, parameter]` tuples
      */
      handleURL: function(url) {
        // Perform a URL-based transition, but don't change
        // the URL afterward, since it already happened.
        var args = slice.call(arguments);
        if (url.charAt(0) !== '/') { args[0] = '/' + url; }

        return doTransition(this, args).method('replaceQuery');
      },

      /**
        Hook point for updating the URL.

        @param {String} url a URL to update to
      */
      updateURL: function() {
        throw new Error("updateURL is not implemented");
      },

      /**
        Hook point for replacing the current URL, i.e. with replaceState

        By default this behaves the same as `updateURL`

        @param {String} url a URL to update to
      */
      replaceURL: function(url) {
        this.updateURL(url);
      },

      /**
        Transition into the specified named route.

        If necessary, trigger the exit callback on any handlers
        that are no longer represented by the target route.

        @param {String} name the name of the route
      */
      transitionTo: function(name) {
        return doTransition(this, arguments);
      },

      intermediateTransitionTo: function(name) {
        doTransition(this, arguments, true);
      },

      refresh: function(pivotHandler) {


        var state = this.activeTransition ? this.activeTransition.state : this.state;
        var handlerInfos = state.handlerInfos;
        var params = {};
        for (var i = 0, len = handlerInfos.length; i < len; ++i) {
          var handlerInfo = handlerInfos[i];
          params[handlerInfo.name] = handlerInfo.params || {};
        }

        log(this, "Starting a refresh transition");
        var intent = new NamedTransitionIntent({
          name: handlerInfos[handlerInfos.length - 1].name,
          pivotHandler: pivotHandler || handlerInfos[0].handler,
          contexts: [], // TODO collect contexts...?
          queryParams: this._changedQueryParams || state.queryParams || {}
        });

        return this.transitionByIntent(intent, false);
      },

      /**
        Identical to `transitionTo` except that the current URL will be replaced
        if possible.

        This method is intended primarily for use with `replaceState`.

        @param {String} name the name of the route
      */
      replaceWith: function(name) {
        return doTransition(this, arguments).method('replace');
      },

      /**
        Take a named route and context objects and generate a
        URL.

        @param {String} name the name of the route to generate
          a URL for
        @param {...Object} objects a list of objects to serialize

        @return {String} a URL
      */
      generate: function(handlerName) {

        var partitionedArgs = extractQueryParams(slice.call(arguments, 1)),
          suppliedParams = partitionedArgs[0],
          queryParams = partitionedArgs[1];

        // Construct a TransitionIntent with the provided params
        // and apply it to the present state of the router.
        var intent = new NamedTransitionIntent({ name: handlerName, contexts: suppliedParams });
        var state = intent.applyToState(this.state, this.recognizer, this.getHandler);
        var params = {};

        for (var i = 0, len = state.handlerInfos.length; i < len; ++i) {
          var handlerInfo = state.handlerInfos[i];
          var handlerParams = handlerInfo.params ||
                              serialize(handlerInfo.handler, handlerInfo.context, handlerInfo.names);
          merge(params, handlerParams);
        }
        params.queryParams = queryParams;

        return this.recognizer.generate(handlerName, params);
      },

      isActive: function(handlerName) {

        var partitionedArgs   = extractQueryParams(slice.call(arguments, 1)),
            contexts          = partitionedArgs[0],
            queryParams       = partitionedArgs[1],
            activeQueryParams  = this.state.queryParams;

        var targetHandlerInfos = this.state.handlerInfos,
            found = false, names, object, handlerInfo, handlerObj, i, len;

        if (!targetHandlerInfos.length) { return false; }

        var targetHandler = targetHandlerInfos[targetHandlerInfos.length - 1].name;
        var recogHandlers = this.recognizer.handlersFor(targetHandler);

        var index = 0;
        for (len = recogHandlers.length; index < len; ++index) {
          handlerInfo = targetHandlerInfos[index];
          if (handlerInfo.name === handlerName) { break; }
        }

        if (index === recogHandlers.length) {
          // The provided route name isn't even in the route hierarchy.
          return false;
        }

        var state = new TransitionState();
        state.handlerInfos = targetHandlerInfos.slice(0, index + 1);
        recogHandlers = recogHandlers.slice(0, index + 1);

        var intent = new NamedTransitionIntent({
          name: targetHandler,
          contexts: contexts
        });

        var newState = intent.applyToHandlers(state, recogHandlers, this.getHandler, targetHandler, true, true);

        // Get a hash of QPs that will still be active on new route
        var activeQPsOnNewHandler = {};
        merge(activeQPsOnNewHandler, queryParams);
        for (var key in activeQueryParams) {
          if (activeQueryParams.hasOwnProperty(key) &&
              activeQPsOnNewHandler.hasOwnProperty(key)) {
            activeQPsOnNewHandler[key] = activeQueryParams[key];
          }
        }

        return handlerInfosEqual(newState.handlerInfos, state.handlerInfos) &&
               !getChangelist(activeQPsOnNewHandler, queryParams);
      },

      trigger: function(name) {
        var args = slice.call(arguments);
        trigger(this, this.currentHandlerInfos, false, args);
      },

      /**
        @private

        Pluggable hook for possibly running route hooks
        in a try-catch escaping manner.

        @param {Function} callback the callback that will
                          be asynchronously called

        @return {Promise} a promise that fulfills with the
                          value returned from the callback
       */
      async: function(callback, label) {
        return new Promise(function(resolve) {
          resolve(callback());
        }, label);
      },

      /**
        Hook point for logging transition status updates.

        @param {String} message The message to log.
      */
      log: null
    };

    /**
      @private

      Takes an Array of `HandlerInfo`s, figures out which ones are
      exiting, entering, or changing contexts, and calls the
      proper handler hooks.

      For example, consider the following tree of handlers. Each handler is
      followed by the URL segment it handles.

      ```
      |~index ("/")
      | |~posts ("/posts")
      | | |-showPost ("/:id")
      | | |-newPost ("/new")
      | | |-editPost ("/edit")
      | |~about ("/about/:id")
      ```

      Consider the following transitions:

      1. A URL transition to `/posts/1`.
         1. Triggers the `*model` callbacks on the
            `index`, `posts`, and `showPost` handlers
         2. Triggers the `enter` callback on the same
         3. Triggers the `setup` callback on the same
      2. A direct transition to `newPost`
         1. Triggers the `exit` callback on `showPost`
         2. Triggers the `enter` callback on `newPost`
         3. Triggers the `setup` callback on `newPost`
      3. A direct transition to `about` with a specified
         context object
         1. Triggers the `exit` callback on `newPost`
            and `posts`
         2. Triggers the `serialize` callback on `about`
         3. Triggers the `enter` callback on `about`
         4. Triggers the `setup` callback on `about`

      @param {Router} transition
      @param {TransitionState} newState
    */
    function setupContexts(router, newState, transition) {
      var partition = partitionHandlers(router.state, newState);

      forEach(partition.exited, function(handlerInfo) {
        var handler = handlerInfo.handler;
        delete handler.context;
        if (handler.exit) { handler.exit(); }
      });

      var oldState = router.oldState = router.state;
      router.state = newState;
      var currentHandlerInfos = router.currentHandlerInfos = partition.unchanged.slice();

      try {
        forEach(partition.updatedContext, function(handlerInfo) {
          return handlerEnteredOrUpdated(currentHandlerInfos, handlerInfo, false, transition);
        });

        forEach(partition.entered, function(handlerInfo) {
          return handlerEnteredOrUpdated(currentHandlerInfos, handlerInfo, true, transition);
        });
      } catch(e) {
        router.state = oldState;
        router.currentHandlerInfos = oldState.handlerInfos;
        throw e;
      }

      router.state.queryParams = finalizeQueryParamChange(router, currentHandlerInfos, newState.queryParams);
    }


    /**
      @private

      Helper method used by setupContexts. Handles errors or redirects
      that may happen in enter/setup.
    */
    function handlerEnteredOrUpdated(currentHandlerInfos, handlerInfo, enter, transition) {

      var handler = handlerInfo.handler,
          context = handlerInfo.context;

      if (enter && handler.enter) { handler.enter(transition); }
      if (transition && transition.isAborted) {
        throw new TransitionAborted();
      }

      handler.context = context;
      if (handler.contextDidChange) { handler.contextDidChange(); }

      if (handler.setup) { handler.setup(context, transition); }
      if (transition && transition.isAborted) {
        throw new TransitionAborted();
      }

      currentHandlerInfos.push(handlerInfo);

      return true;
    }


    /**
      @private

      This function is called when transitioning from one URL to
      another to determine which handlers are no longer active,
      which handlers are newly active, and which handlers remain
      active but have their context changed.

      Take a list of old handlers and new handlers and partition
      them into four buckets:

      * unchanged: the handler was active in both the old and
        new URL, and its context remains the same
      * updated context: the handler was active in both the
        old and new URL, but its context changed. The handler's
        `setup` method, if any, will be called with the new
        context.
      * exited: the handler was active in the old URL, but is
        no longer active.
      * entered: the handler was not active in the old URL, but
        is now active.

      The PartitionedHandlers structure has four fields:

      * `updatedContext`: a list of `HandlerInfo` objects that
        represent handlers that remain active but have a changed
        context
      * `entered`: a list of `HandlerInfo` objects that represent
        handlers that are newly active
      * `exited`: a list of `HandlerInfo` objects that are no
        longer active.
      * `unchanged`: a list of `HanderInfo` objects that remain active.

      @param {Array[HandlerInfo]} oldHandlers a list of the handler
        information for the previous URL (or `[]` if this is the
        first handled transition)
      @param {Array[HandlerInfo]} newHandlers a list of the handler
        information for the new URL

      @return {Partition}
    */
    function partitionHandlers(oldState, newState) {
      var oldHandlers = oldState.handlerInfos;
      var newHandlers = newState.handlerInfos;

      var handlers = {
            updatedContext: [],
            exited: [],
            entered: [],
            unchanged: []
          };

      var handlerChanged, contextChanged, queryParamsChanged, i, l;

      for (i=0, l=newHandlers.length; i<l; i++) {
        var oldHandler = oldHandlers[i], newHandler = newHandlers[i];

        if (!oldHandler || oldHandler.handler !== newHandler.handler) {
          handlerChanged = true;
        }

        if (handlerChanged) {
          handlers.entered.push(newHandler);
          if (oldHandler) { handlers.exited.unshift(oldHandler); }
        } else if (contextChanged || oldHandler.context !== newHandler.context || queryParamsChanged) {
          contextChanged = true;
          handlers.updatedContext.push(newHandler);
        } else {
          handlers.unchanged.push(oldHandler);
        }
      }

      for (i=newHandlers.length, l=oldHandlers.length; i<l; i++) {
        handlers.exited.unshift(oldHandlers[i]);
      }

      return handlers;
    }

    function updateURL(transition, state, inputUrl) {
      var urlMethod = transition.urlMethod;

      if (!urlMethod) {
        return;
      }

      var router = transition.router,
          handlerInfos = state.handlerInfos,
          handlerName = handlerInfos[handlerInfos.length - 1].name,
          params = {};

      for (var i = handlerInfos.length - 1; i >= 0; --i) {
        var handlerInfo = handlerInfos[i];
        merge(params, handlerInfo.params);
        if (handlerInfo.handler.inaccessibleByURL) {
          urlMethod = null;
        }
      }

      if (urlMethod) {
        params.queryParams = state.queryParams;
        var url = router.recognizer.generate(handlerName, params);

        if (urlMethod === 'replaceQuery') {
          if (url !== inputUrl) {
            router.replaceURL(url);
          }
        } else if (urlMethod === 'replace') {
          router.replaceURL(url);
        } else {
          router.updateURL(url);
        }
      }
    }

    /**
      @private

      Updates the URL (if necessary) and calls `setupContexts`
      to update the router's array of `currentHandlerInfos`.
     */
    function finalizeTransition(transition, newState) {

      try {
        log(transition.router, transition.sequence, "Resolved all models on destination route; finalizing transition.");

        var router = transition.router,
            handlerInfos = newState.handlerInfos,
            seq = transition.sequence;

        // Run all the necessary enter/setup/exit hooks
        setupContexts(router, newState, transition);

        // Check if a redirect occurred in enter/setup
        if (transition.isAborted) {
          // TODO: cleaner way? distinguish b/w targetHandlerInfos?
          router.state.handlerInfos = router.currentHandlerInfos;
          return reject(logAbort(transition));
        }

        updateURL(transition, newState, transition.intent.url);

        transition.isActive = false;
        router.activeTransition = null;

        trigger(router, router.currentHandlerInfos, true, ['didTransition']);

        if (router.didTransition) {
          router.didTransition(router.currentHandlerInfos);
        }

        log(router, transition.sequence, "TRANSITION COMPLETE.");

        // Resolve with the final handler.
        return handlerInfos[handlerInfos.length - 1].handler;
      } catch(e) {
        if (!(e instanceof TransitionAborted)) {
          //var erroneousHandler = handlerInfos.pop();
          var infos = transition.state.handlerInfos;
          transition.trigger(true, 'error', e, transition, infos[infos.length-1].handler);
          transition.abort();
        }

        throw e;
      }
    }

    /**
      @private

      Begins and returns a Transition based on the provided
      arguments. Accepts arguments in the form of both URL
      transitions and named transitions.

      @param {Router} router
      @param {Array[Object]} args arguments passed to transitionTo,
        replaceWith, or handleURL
    */
    function doTransition(router, args, isIntermediate) {
      // Normalize blank transitions to root URL transitions.
      var name = args[0] || '/';

      var lastArg = args[args.length-1];
      var queryParams = {};
      if (lastArg && lastArg.hasOwnProperty('queryParams')) {
        queryParams = pop.call(args).queryParams;
      }

      var intent;
      if (args.length === 0) {

        log(router, "Updating query params");

        // A query param update is really just a transition
        // into the route you're already on.
        var handlerInfos = router.state.handlerInfos;
        intent = new NamedTransitionIntent({
          name: handlerInfos[handlerInfos.length - 1].name,
          contexts: [],
          queryParams: queryParams
        });

      } else if (name.charAt(0) === '/') {

        log(router, "Attempting URL transition to " + name);
        intent = new URLTransitionIntent({ url: name });

      } else {

        log(router, "Attempting transition to " + name);
        intent = new NamedTransitionIntent({
          name: args[0],
          contexts: slice.call(args, 1),
          queryParams: queryParams
        });
      }

      return router.transitionByIntent(intent, isIntermediate);
    }

    function handlerInfosEqual(handlerInfos, otherHandlerInfos) {
      if (handlerInfos.length !== otherHandlerInfos.length) {
        return false;
      }

      for (var i = 0, len = handlerInfos.length; i < len; ++i) {
        if (handlerInfos[i] !== otherHandlerInfos[i]) {
          return false;
        }
      }
      return true;
    }

    function finalizeQueryParamChange(router, resolvedHandlers, newQueryParams) {
      // We fire a finalizeQueryParamChange event which
      // gives the new route hierarchy a chance to tell
      // us which query params it's consuming and what
      // their final values are. If a query param is
      // no longer consumed in the final route hierarchy,
      // its serialized segment will be removed
      // from the URL.
      var finalQueryParamsArray = [];
      trigger(router, resolvedHandlers, true, ['finalizeQueryParamChange', newQueryParams, finalQueryParamsArray]);

      var finalQueryParams = {};
      for (var i = 0, len = finalQueryParamsArray.length; i < len; ++i) {
        var qp = finalQueryParamsArray[i];
        finalQueryParams[qp.key] = qp.value;
      }
      return finalQueryParams;
    }

    __exports__.Router = Router;
  });
define("router/transition-intent", 
  ["./utils","exports"],
  function(__dependency1__, __exports__) {
    "use strict";
    var merge = __dependency1__.merge;

    function TransitionIntent(props) {
      if (props) {
        merge(this, props);
      }
      this.data = this.data || {};
    }

    TransitionIntent.prototype.applyToState = function(oldState) {
      // Default TransitionIntent is a no-op.
      return oldState;
    };

    __exports__.TransitionIntent = TransitionIntent;
  });
define("router/transition-intent/named-transition-intent", 
  ["../transition-intent","../transition-state","../handler-info","../utils","exports"],
  function(__dependency1__, __dependency2__, __dependency3__, __dependency4__, __exports__) {
    "use strict";
    var TransitionIntent = __dependency1__.TransitionIntent;
    var TransitionState = __dependency2__.TransitionState;
    var UnresolvedHandlerInfoByParam = __dependency3__.UnresolvedHandlerInfoByParam;
    var UnresolvedHandlerInfoByObject = __dependency3__.UnresolvedHandlerInfoByObject;
    var isParam = __dependency4__.isParam;
    var forEach = __dependency4__.forEach;
    var extractQueryParams = __dependency4__.extractQueryParams;
    var oCreate = __dependency4__.oCreate;
    var merge = __dependency4__.merge;

    function NamedTransitionIntent(props) {
      TransitionIntent.call(this, props);
    }

    NamedTransitionIntent.prototype = oCreate(TransitionIntent.prototype);
    NamedTransitionIntent.prototype.applyToState = function(oldState, recognizer, getHandler, isIntermediate) {

      var partitionedArgs     = extractQueryParams([this.name].concat(this.contexts)),
        pureArgs              = partitionedArgs[0],
        queryParams           = partitionedArgs[1],
        handlers              = recognizer.handlersFor(pureArgs[0]);

      var targetRouteName = handlers[handlers.length-1].handler;

      return this.applyToHandlers(oldState, handlers, getHandler, targetRouteName, isIntermediate);
    };

    NamedTransitionIntent.prototype.applyToHandlers = function(oldState, handlers, getHandler, targetRouteName, isIntermediate, checkingIfActive) {

      var i;
      var newState = new TransitionState();
      var objects = this.contexts.slice(0);

      var invalidateIndex = handlers.length;
      var nonDynamicIndexes = [];

      // Pivot handlers are provided for refresh transitions
      if (this.pivotHandler) {
        for (i = 0; i < handlers.length; ++i) {
          if (getHandler(handlers[i].handler) === this.pivotHandler) {
            invalidateIndex = i;
            break;
          }
        }
      }

      var pivotHandlerFound = !this.pivotHandler;

      for (i = handlers.length - 1; i >= 0; --i) {
        var result = handlers[i];
        var name = result.handler;
        var handler = getHandler(name);

        var oldHandlerInfo = oldState.handlerInfos[i];
        var newHandlerInfo = null;

        if (result.names.length > 0) {
          if (i >= invalidateIndex) {
            newHandlerInfo = this.createParamHandlerInfo(name, handler, result.names, objects, oldHandlerInfo);
          } else {
            newHandlerInfo = this.getHandlerInfoForDynamicSegment(name, handler, result.names, objects, oldHandlerInfo, targetRouteName);
          }
        } else {
          // This route has no dynamic segment.
          // Therefore treat as a param-based handlerInfo
          // with empty params. This will cause the `model`
          // hook to be called with empty params, which is desirable.
          newHandlerInfo = this.createParamHandlerInfo(name, handler, result.names, objects, oldHandlerInfo);
          nonDynamicIndexes.unshift(i);
        }

        if (checkingIfActive) {
          // If we're performing an isActive check, we want to
          // serialize URL params with the provided context, but
          // ignore mismatches between old and new context.
          newHandlerInfo = newHandlerInfo.becomeResolved(null, newHandlerInfo.context);
          var oldContext = oldHandlerInfo && oldHandlerInfo.context;
          if (result.names.length > 0 && newHandlerInfo.context === oldContext) {
            // If contexts match in isActive test, assume params also match.
            // This allows for flexibility in not requiring that every last
            // handler provide a `serialize` method
            newHandlerInfo.params = oldHandlerInfo && oldHandlerInfo.params;
          }
          newHandlerInfo.context = oldContext;
        }

        var handlerToUse = oldHandlerInfo;
        if (i >= invalidateIndex || newHandlerInfo.shouldSupercede(oldHandlerInfo)) {
          invalidateIndex = Math.min(i, invalidateIndex);
          handlerToUse = newHandlerInfo;
        }

        if (isIntermediate && !checkingIfActive) {
          handlerToUse = handlerToUse.becomeResolved(null, handlerToUse.context);
        }

        newState.handlerInfos.unshift(handlerToUse);
      }

      if (objects.length > 0) {
        throw new Error("More context objects were passed than there are dynamic segments for the route: " + targetRouteName);
      }

      if (!isIntermediate) {
        this.invalidateNonDynamicHandlers(newState.handlerInfos, nonDynamicIndexes, invalidateIndex);
      }

      merge(newState.queryParams, oldState.queryParams);
      merge(newState.queryParams, this.queryParams || {});

      return newState;
    };

    NamedTransitionIntent.prototype.invalidateNonDynamicHandlers = function(handlerInfos, indexes, invalidateIndex) {
      forEach(indexes, function(i) {
        if (i >= invalidateIndex) {
          var handlerInfo = handlerInfos[i];
          handlerInfos[i] = new UnresolvedHandlerInfoByParam({
            name: handlerInfo.name,
            handler: handlerInfo.handler,
            params: {}
          });
        }
      });
    };

    NamedTransitionIntent.prototype.getHandlerInfoForDynamicSegment = function(name, handler, names, objects, oldHandlerInfo, targetRouteName) {

      var numNames = names.length;
      var objectToUse;
      if (objects.length > 0) {

        // Use the objects provided for this transition.
        objectToUse = objects[objects.length - 1];
        if (isParam(objectToUse)) {
          return this.createParamHandlerInfo(name, handler, names, objects, oldHandlerInfo);
        } else {
          objects.pop();
        }
      } else if (oldHandlerInfo && oldHandlerInfo.name === name) {
        // Reuse the matching oldHandlerInfo
        return oldHandlerInfo;
      } else {
        // Ideally we should throw this error to provide maximal
        // information to the user that not enough context objects
        // were provided, but this proves too cumbersome in Ember
        // in cases where inner template helpers are evaluated
        // before parent helpers un-render, in which cases this
        // error somewhat prematurely fires.
        //throw new Error("Not enough context objects were provided to complete a transition to " + targetRouteName + ". Specifically, the " + name + " route needs an object that can be serialized into its dynamic URL segments [" + names.join(', ') + "]");
        return oldHandlerInfo;
      }

      return new UnresolvedHandlerInfoByObject({
        name: name,
        handler: handler,
        context: objectToUse,
        names: names
      });
    };

    NamedTransitionIntent.prototype.createParamHandlerInfo = function(name, handler, names, objects, oldHandlerInfo) {
      var params = {};

      // Soak up all the provided string/numbers
      var numNames = names.length;
      while (numNames--) {

        // Only use old params if the names match with the new handler
        var oldParams = (oldHandlerInfo && name === oldHandlerInfo.name && oldHandlerInfo.params) || {};

        var peek = objects[objects.length - 1];
        var paramName = names[numNames];
        if (isParam(peek)) {
          params[paramName] = "" + objects.pop();
        } else {
          // If we're here, this means only some of the params
          // were string/number params, so try and use a param
          // value from a previous handler.
          if (oldParams.hasOwnProperty(paramName)) {
            params[paramName] = oldParams[paramName];
          } else {
            throw new Error("You didn't provide enough string/numeric parameters to satisfy all of the dynamic segments for route " + name);
          }
        }
      }

      return new UnresolvedHandlerInfoByParam({
        name: name,
        handler: handler,
        params: params
      });
    };

    __exports__.NamedTransitionIntent = NamedTransitionIntent;
  });
define("router/transition-intent/url-transition-intent", 
  ["../transition-intent","../transition-state","../handler-info","../utils","exports"],
  function(__dependency1__, __dependency2__, __dependency3__, __dependency4__, __exports__) {
    "use strict";
    var TransitionIntent = __dependency1__.TransitionIntent;
    var TransitionState = __dependency2__.TransitionState;
    var UnresolvedHandlerInfoByParam = __dependency3__.UnresolvedHandlerInfoByParam;
    var oCreate = __dependency4__.oCreate;
    var merge = __dependency4__.merge;

    function URLTransitionIntent(props) {
      TransitionIntent.call(this, props);
    }

    URLTransitionIntent.prototype = oCreate(TransitionIntent.prototype);
    URLTransitionIntent.prototype.applyToState = function(oldState, recognizer, getHandler) {
      var newState = new TransitionState();

      var results = recognizer.recognize(this.url),
          queryParams = {},
          i, len;

      if (!results) {
        throw new UnrecognizedURLError(this.url);
      }

      var statesDiffer = false;

      for (i = 0, len = results.length; i < len; ++i) {
        var result = results[i];
        var name = result.handler;
        var handler = getHandler(name);

        if (handler.inaccessibleByURL) {
          throw new UnrecognizedURLError(this.url);
        }

        var newHandlerInfo = new UnresolvedHandlerInfoByParam({
          name: name,
          handler: handler,
          params: result.params
        });

        var oldHandlerInfo = oldState.handlerInfos[i];
        if (statesDiffer || newHandlerInfo.shouldSupercede(oldHandlerInfo)) {
          statesDiffer = true;
          newState.handlerInfos[i] = newHandlerInfo;
        } else {
          newState.handlerInfos[i] = oldHandlerInfo;
        }
      }

      merge(newState.queryParams, results.queryParams);

      return newState;
    };

    /**
      Promise reject reasons passed to promise rejection
      handlers for failed transitions.
     */
    function UnrecognizedURLError(message) {
      this.message = (message || "UnrecognizedURLError");
      this.name = "UnrecognizedURLError";
    }

    __exports__.URLTransitionIntent = URLTransitionIntent;
  });
define("router/transition-state", 
  ["./handler-info","./utils","rsvp","exports"],
  function(__dependency1__, __dependency2__, __dependency3__, __exports__) {
    "use strict";
    var ResolvedHandlerInfo = __dependency1__.ResolvedHandlerInfo;
    var forEach = __dependency2__.forEach;
    var promiseLabel = __dependency2__.promiseLabel;
    var resolve = __dependency3__.resolve;
    var reject = __dependency3__.reject;

    function TransitionState(other) {
      this.handlerInfos = [];
      this.queryParams = {};
      this.params = {};
    }

    TransitionState.prototype = {
      handlerInfos: null,
      queryParams: null,
      params: null,

      promiseLabel: function(label) {
        var targetName = '';
        forEach(this.handlerInfos, function(handlerInfo) {
          if (targetName !== '') {
            targetName += '.';
          }
          targetName += handlerInfo.name;
        });
        return promiseLabel("'" + targetName + "': " + label);
      },

      resolve: function(async, shouldContinue, payload) {
        var self = this;
        // First, calculate params for this state. This is useful
        // information to provide to the various route hooks.
        var params = this.params;
        forEach(this.handlerInfos, function(handlerInfo) {
          params[handlerInfo.name] = handlerInfo.params || {};
        });

        payload = payload || {};
        payload.resolveIndex = 0;

        var currentState = this;
        var wasAborted = false;

        // The prelude RSVP.resolve() asyncs us into the promise land.
        return resolve(null, this.promiseLabel("Start transition"))
        .then(resolveOneHandlerInfo, null, this.promiseLabel('Resolve handler'))['catch'](handleError, this.promiseLabel('Handle error'));

        function innerShouldContinue() {
          return resolve(shouldContinue(), promiseLabel("Check if should continue"))['catch'](function(reason) {
            // We distinguish between errors that occurred
            // during resolution (e.g. beforeModel/model/afterModel),
            // and aborts due to a rejecting promise from shouldContinue().
            wasAborted = true;
            return reject(reason);
          }, promiseLabel("Handle abort"));
        }

        function handleError(error) {
          // This is the only possible
          // reject value of TransitionState#resolve
          var handlerInfos = currentState.handlerInfos;
          var errorHandlerIndex = payload.resolveIndex >= handlerInfos.length ?
                                  handlerInfos.length - 1 : payload.resolveIndex;
          return reject({
            error: error,
            handlerWithError: currentState.handlerInfos[errorHandlerIndex].handler,
            wasAborted: wasAborted,
            state: currentState
          });
        }

        function proceed(resolvedHandlerInfo) {
          // Swap the previously unresolved handlerInfo with
          // the resolved handlerInfo
          currentState.handlerInfos[payload.resolveIndex++] = resolvedHandlerInfo;

          // Call the redirect hook. The reason we call it here
          // vs. afterModel is so that redirects into child
          // routes don't re-run the model hooks for this
          // already-resolved route.
          var handler = resolvedHandlerInfo.handler;
          if (handler && handler.redirect) {
            handler.redirect(resolvedHandlerInfo.context, payload);
          }

          // Proceed after ensuring that the redirect hook
          // didn't abort this transition by transitioning elsewhere.
          return innerShouldContinue().then(resolveOneHandlerInfo, null, promiseLabel('Resolve handler'));
        }

        function resolveOneHandlerInfo() {
          if (payload.resolveIndex === currentState.handlerInfos.length) {
            // This is is the only possible
            // fulfill value of TransitionState#resolve
            return {
              error: null,
              state: currentState
            };
          }

          var handlerInfo = currentState.handlerInfos[payload.resolveIndex];

          return handlerInfo.resolve(async, innerShouldContinue, payload)
                            .then(proceed, null, promiseLabel('Proceed'));
        }
      }
    };

    __exports__.TransitionState = TransitionState;
  });
define("router/transition", 
  ["rsvp","./handler-info","./utils","exports"],
  function(__dependency1__, __dependency2__, __dependency3__, __exports__) {
    "use strict";
    var reject = __dependency1__.reject;
    var resolve = __dependency1__.resolve;
    var ResolvedHandlerInfo = __dependency2__.ResolvedHandlerInfo;
    var trigger = __dependency3__.trigger;
    var slice = __dependency3__.slice;
    var log = __dependency3__.log;
    var promiseLabel = __dependency3__.promiseLabel;

    /**
      @private

      A Transition is a thennable (a promise-like object) that represents
      an attempt to transition to another route. It can be aborted, either
      explicitly via `abort` or by attempting another transition while a
      previous one is still underway. An aborted transition can also
      be `retry()`d later.
     */
    function Transition(router, intent, state, error) {
      var transition = this;
      this.state = state || router.state;
      this.intent = intent;
      this.router = router;
      this.data = this.intent && this.intent.data || {};
      this.resolvedModels = {};
      this.queryParams = {};

      if (error) {
        this.promise = reject(error);
        return;
      }

      if (state) {
        this.params = state.params;
        this.queryParams = state.queryParams;

        var len = state.handlerInfos.length;
        if (len) {
          this.targetName = state.handlerInfos[state.handlerInfos.length-1].name;
        }

        for (var i = 0; i < len; ++i) {
          var handlerInfo = state.handlerInfos[i];
          if (!(handlerInfo instanceof ResolvedHandlerInfo)) {
            break;
          }
          this.pivotHandler = handlerInfo.handler;
        }

        this.sequence = Transition.currentSequence++;
        this.promise = state.resolve(router.async, checkForAbort, this)['catch'](function(result) {
          if (result.wasAborted) {
            return reject(logAbort(transition));
          } else {
            transition.trigger('error', result.error, transition, result.handlerWithError);
            transition.abort();
            return reject(result.error);
          }
        }, promiseLabel('Handle Abort'));
      } else {
        this.promise = resolve(this.state);
        this.params = {};
      }

      function checkForAbort() {
        if (transition.isAborted) {
          return reject(undefined, promiseLabel("Transition aborted - reject"));
        }
      }
    }

    Transition.currentSequence = 0;

    Transition.prototype = {
      targetName: null,
      urlMethod: 'update',
      intent: null,
      params: null,
      pivotHandler: null,
      resolveIndex: 0,
      handlerInfos: null,
      resolvedModels: null,
      isActive: true,
      state: null,

      /**
        @public

        The Transition's internal promise. Calling `.then` on this property
        is that same as calling `.then` on the Transition object itself, but
        this property is exposed for when you want to pass around a
        Transition's promise, but not the Transition object itself, since
        Transition object can be externally `abort`ed, while the promise
        cannot.
       */
      promise: null,

      /**
        @public

        Custom state can be stored on a Transition's `data` object.
        This can be useful for decorating a Transition within an earlier
        hook and shared with a later hook. Properties set on `data` will
        be copied to new transitions generated by calling `retry` on this
        transition.
       */
      data: null,

      /**
        @public

        A standard promise hook that resolves if the transition
        succeeds and rejects if it fails/redirects/aborts.

        Forwards to the internal `promise` property which you can
        use in situations where you want to pass around a thennable,
        but not the Transition itself.

        @param {Function} success
        @param {Function} failure
       */
      then: function(success, failure) {
        return this.promise.then(success, failure);
      },

      /**
        @public

        Aborts the Transition. Note you can also implicitly abort a transition
        by initiating another transition while a previous one is underway.
       */
      abort: function() {
        if (this.isAborted) { return this; }
        log(this.router, this.sequence, this.targetName + ": transition was aborted");
        this.isAborted = true;
        this.isActive = false;
        this.router.activeTransition = null;
        return this;
      },

      /**
        @public

        Retries a previously-aborted transition (making sure to abort the
        transition if it's still active). Returns a new transition that
        represents the new attempt to transition.
       */
      retry: function() {
        // TODO: add tests for merged state retry()s
        this.abort();
        return this.router.transitionByIntent(this.intent, false);
      },

      /**
        @public

        Sets the URL-changing method to be employed at the end of a
        successful transition. By default, a new Transition will just
        use `updateURL`, but passing 'replace' to this method will
        cause the URL to update using 'replaceWith' instead. Omitting
        a parameter will disable the URL change, allowing for transitions
        that don't update the URL at completion (this is also used for
        handleURL, since the URL has already changed before the
        transition took place).

        @param {String} method the type of URL-changing method to use
          at the end of a transition. Accepted values are 'replace',
          falsy values, or any other non-falsy value (which is
          interpreted as an updateURL transition).

        @return {Transition} this transition
       */
      method: function(method) {
        this.urlMethod = method;
        return this;
      },

      /**
        @public

        Fires an event on the current list of resolved/resolving
        handlers within this transition. Useful for firing events
        on route hierarchies that haven't fully been entered yet.

        Note: This method is also aliased as `send`

        @param {Boolean} [ignoreFailure=false] a boolean specifying whether unhandled events throw an error
        @param {String} name the name of the event to fire
       */
      trigger: function (ignoreFailure) {
        var args = slice.call(arguments);
        if (typeof ignoreFailure === 'boolean') {
          args.shift();
        } else {
          // Throw errors on unhandled trigger events by default
          ignoreFailure = false;
        }
        trigger(this.router, this.state.handlerInfos.slice(0, this.resolveIndex + 1), ignoreFailure, args);
      },

      /**
        @public

        Transitions are aborted and their promises rejected
        when redirects occur; this method returns a promise
        that will follow any redirects that occur and fulfill
        with the value fulfilled by any redirecting transitions
        that occur.

        @return {Promise} a promise that fulfills with the same
          value that the final redirecting transition fulfills with
       */
      followRedirects: function() {
        var router = this.router;
        return this.promise['catch'](function(reason) {
          if (router.activeTransition) {
            return router.activeTransition.followRedirects();
          }
          return reject(reason);
        });
      },

      toString: function() {
        return "Transition (sequence " + this.sequence + ")";
      },

      /**
        @private
       */
      log: function(message) {
        log(this.router, this.sequence, message);
      }
    };

    // Alias 'trigger' as 'send'
    Transition.prototype.send = Transition.prototype.trigger;

    /**
      @private

      Logs and returns a TransitionAborted error.
     */
    function logAbort(transition) {
      log(transition.router, transition.sequence, "detected abort.");
      return new TransitionAborted();
    }

    function TransitionAborted(message) {
      this.message = (message || "TransitionAborted");
      this.name = "TransitionAborted";
    }

    __exports__.Transition = Transition;
    __exports__.logAbort = logAbort;
    __exports__.TransitionAborted = TransitionAborted;
  });
define("router/utils", 
  ["exports"],
  function(__exports__) {
    "use strict";
    var slice = Array.prototype.slice;

    function isArray(test) {
      return Object.prototype.toString.call(test) === "[object Array]";
    }

    function merge(hash, other) {
      for (var prop in other) {
        if (other.hasOwnProperty(prop)) { hash[prop] = other[prop]; }
      }
    }

    var oCreate = Object.create || function(proto) {
      function F() {}
      F.prototype = proto;
      return new F();
    };

    /**
      @private

      Extracts query params from the end of an array
    **/
    function extractQueryParams(array) {
      var len = (array && array.length), head, queryParams;

      if(len && len > 0 && array[len - 1] && array[len - 1].hasOwnProperty('queryParams')) {
        queryParams = array[len - 1].queryParams;
        head = slice.call(array, 0, len - 1);
        return [head, queryParams];
      } else {
        return [array, null];
      }
    }

    /**
      @private

      Coerces query param properties and array elements into strings.
    **/
    function coerceQueryParamsToString(queryParams) {
      for (var key in queryParams) {
        if (typeof queryParams[key] === 'number') {
          queryParams[key] = '' + queryParams[key];
        } else if (isArray(queryParams[key])) {
          for (var i = 0, l = queryParams[key].length; i < l; i++) {
            queryParams[key][i] = '' + queryParams[key][i];
          }
        }
      }
    }
    /**
      @private
     */
    function log(router, sequence, msg) {
      if (!router.log) { return; }

      if (arguments.length === 3) {
        router.log("Transition #" + sequence + ": " + msg);
      } else {
        msg = sequence;
        router.log(msg);
      }
    }

    function bind(fn, context) {
      var boundArgs = arguments;
      return function(value) {
        var args = slice.call(boundArgs, 2);
        args.push(value);
        return fn.apply(context, args);
      };
    }

    function isParam(object) {
      return (typeof object === "string" || object instanceof String || typeof object === "number" || object instanceof Number);
    }


    function forEach(array, callback) {
      for (var i=0, l=array.length; i<l && false !== callback(array[i]); i++) { }
    }

    /**
      @private

      Serializes a handler using its custom `serialize` method or
      by a default that looks up the expected property name from
      the dynamic segment.

      @param {Object} handler a router handler
      @param {Object} model the model to be serialized for this handler
      @param {Array[Object]} names the names array attached to an
        handler object returned from router.recognizer.handlersFor()
    */
    function serialize(handler, model, names) {
      var object = {};
      if (isParam(model)) {
        object[names[0]] = model;
        return object;
      }

      // Use custom serialize if it exists.
      if (handler.serialize) {
        return handler.serialize(model, names);
      }

      if (names.length !== 1) { return; }

      var name = names[0];

      if (/_id$/.test(name)) {
        object[name] = model.id;
      } else {
        object[name] = model;
      }
      return object;
    }

    function trigger(router, handlerInfos, ignoreFailure, args) {
      if (router.triggerEvent) {
        router.triggerEvent(handlerInfos, ignoreFailure, args);
        return;
      }

      var name = args.shift();

      if (!handlerInfos) {
        if (ignoreFailure) { return; }
        throw new Error("Could not trigger event '" + name + "'. There are no active handlers");
      }

      var eventWasHandled = false;

      for (var i=handlerInfos.length-1; i>=0; i--) {
        var handlerInfo = handlerInfos[i],
            handler = handlerInfo.handler;

        if (handler.events && handler.events[name]) {
          if (handler.events[name].apply(handler, args) === true) {
            eventWasHandled = true;
          } else {
            return;
          }
        }
      }

      if (!eventWasHandled && !ignoreFailure) {
        throw new Error("Nothing handled the event '" + name + "'.");
      }
    }

    function getChangelist(oldObject, newObject) {
      var key;
      var results = {
        all: {},
        changed: {},
        removed: {}
      };

      merge(results.all, newObject);

      var didChange = false;
      coerceQueryParamsToString(oldObject);
      coerceQueryParamsToString(newObject);

      // Calculate removals
      for (key in oldObject) {
        if (oldObject.hasOwnProperty(key)) {
          if (!newObject.hasOwnProperty(key)) {
            didChange = true;
            results.removed[key] = oldObject[key];
          }
        }
      }

      // Calculate changes
      for (key in newObject) {
        if (newObject.hasOwnProperty(key)) {
          if (isArray(oldObject[key]) && isArray(newObject[key])) {
            if (oldObject[key].length !== newObject[key].length) {
              results.changed[key] = newObject[key];
              didChange = true;
            } else {
              for (var i = 0, l = oldObject[key].length; i < l; i++) {
                if (oldObject[key][i] !== newObject[key][i]) {
                  results.changed[key] = newObject[key];
                  didChange = true;
                }
              }
            }
          }
          else {
            if (oldObject[key] !== newObject[key]) {
              results.changed[key] = newObject[key];
              didChange = true;
            }
          }
        }
      }

      return didChange && results;
    }

    function promiseLabel(label) {
      return 'Router: ' + label;
    }

    __exports__.trigger = trigger;
    __exports__.log = log;
    __exports__.oCreate = oCreate;
    __exports__.merge = merge;
    __exports__.extractQueryParams = extractQueryParams;
    __exports__.bind = bind;
    __exports__.isParam = isParam;
    __exports__.forEach = forEach;
    __exports__.slice = slice;
    __exports__.serialize = serialize;
    __exports__.getChangelist = getChangelist;
    __exports__.coerceQueryParamsToString = coerceQueryParamsToString;
    __exports__.promiseLabel = promiseLabel;
  });
define("router", 
  ["./router/router","exports"],
  function(__dependency1__, __exports__) {
    "use strict";
    var Router = __dependency1__.Router;

    __exports__.Router = Router;
  });
})();



(function() {
/**
@module ember
@submodule ember-routing
*/

function DSL(name) {
  this.parent = name;
  this.matches = [];
}

DSL.prototype = {
  resource: function(name, options, callback) {
    Ember.assert("'basic' cannot be used as a resource name.", name !== 'basic');

    if (arguments.length === 2 && typeof options === 'function') {
      callback = options;
      options = {};
    }

    if (arguments.length === 1) {
      options = {};
    }

    if (typeof options.path !== 'string') {
      options.path = "/" + name;
    }

    if (callback) {
      var dsl = new DSL(name);
      route(dsl, 'loading');
      route(dsl, 'error', { path: "/_unused_dummy_error_path_route_" + name + "/:error" });
      callback.call(dsl);
      this.push(options.path, name, dsl.generate());
    } else {
      this.push(options.path, name, null);
    }


    if (Ember.FEATURES.isEnabled("ember-routing-named-substates")) {
      // For namespace-preserving nested resource (e.g. resource('foo.bar') within
      // resource('foo')) we only want to use the last route name segment to determine
      // the names of the error/loading substates (e.g. 'bar_loading')
      name = name.split('.').pop();
      route(this, name + '_loading');
      route(this, name + '_error', { path: "/_unused_dummy_error_path_route_" + name + "/:error" });
    }
  },

  push: function(url, name, callback) {
    var parts = name.split('.');
    if (url === "" || url === "/" || parts[parts.length-1] === "index") { this.explicitIndex = true; }

    this.matches.push([url, name, callback]);
  },

  route: function(name, options) {
    Ember.assert("'basic' cannot be used as a route name.", name !== 'basic');

    route(this, name, options);
    if (Ember.FEATURES.isEnabled("ember-routing-named-substates")) {
      route(this, name + '_loading');
      route(this, name + '_error', { path: "/_unused_dummy_error_path_route_" + name + "/:error" });
    }
  },

  generate: function() {
    var dslMatches = this.matches;

    if (!this.explicitIndex) {
      this.route("index", { path: "/" });
    }

    return function(match) {
      for (var i=0, l=dslMatches.length; i<l; i++) {
        var dslMatch = dslMatches[i];
        var matchObj = match(dslMatch[0]).to(dslMatch[1], dslMatch[2]);
      }
    };
  }
};

function route(dsl, name, options) {
  Ember.assert("You must use `this.resource` to nest", typeof options !== 'function');

  options = options || {};

  if (typeof options.path !== 'string') {
    options.path = "/" + name;
  }

  if (dsl.parent && dsl.parent !== 'application') {
    name = dsl.parent + "." + name;
  }

  dsl.push(options.path, name, null);
}

DSL.map = function(callback) {
  var dsl = new DSL();
  callback.call(dsl);
  return dsl;
};

Ember.RouterDSL = DSL;

})();



(function() {
var get = Ember.get;

/**
@module ember
@submodule ember-routing
*/

/**

  Finds a controller instance.

  @for Ember
  @method controllerFor
  @private
*/
Ember.controllerFor = function(container, controllerName, lookupOptions) {
  return container.lookup('controller:' + controllerName, lookupOptions);
};

/**
  Generates a controller factory

  The type of the generated controller factory is derived
  from the context. If the context is an array an array controller
  is generated, if an object, an object controller otherwise, a basic
  controller is generated.

  You can customize your generated controllers by defining
  `App.ObjectController` or `App.ArrayController`.

  @for Ember
  @method generateControllerFactory
  @private
*/
Ember.generateControllerFactory = function(container, controllerName, context) {
  var Factory, fullName, instance, name, factoryName, controllerType;

  if (context && Ember.isArray(context)) {
    controllerType = 'array';
  } else if (context) {
    controllerType = 'object';
  } else {
    controllerType = 'basic';
  }

  factoryName = 'controller:' + controllerType;

  Factory = container.lookupFactory(factoryName).extend({
    isGenerated: true,
    toString: function() {
      return "(generated " + controllerName + " controller)";
    }
  });

  fullName = 'controller:' + controllerName;

  container.register(fullName,  Factory);

  return Factory;
};

/**
  Generates and instantiates a controller.

  The type of the generated controller factory is derived
  from the context. If the context is an array an array controller
  is generated, if an object, an object controller otherwise, a basic
  controller is generated.

  @for Ember
  @method generateController
  @private
*/
Ember.generateController = function(container, controllerName, context) {
  Ember.generateControllerFactory(container, controllerName, context);
  var fullName = 'controller:' + controllerName;
  var instance = container.lookup(fullName);

  if (get(instance, 'namespace.LOG_ACTIVE_GENERATION')) {
    Ember.Logger.info("generated -> " + fullName, { fullName: fullName });
  }

  return instance;
};

})();



(function() {
/**
@module ember
@submodule ember-routing
*/

var routerJsModule = requireModule("router");
var Router = routerJsModule.Router;
var Transition = routerJsModule.Transition;
var get = Ember.get, set = Ember.set, fmt = Ember.String.fmt;
var defineProperty = Ember.defineProperty;
var slice = Array.prototype.slice;
var forEach = Ember.EnumerableUtils.forEach;

var DefaultView = Ember._MetamorphView;
/**
  The `Ember.Router` class manages the application state and URLs. Refer to
  the [routing guide](http://emberjs.com/guides/routing/) for documentation.

  @class Router
  @namespace Ember
  @extends Ember.Object
*/
Ember.Router = Ember.Object.extend(Ember.Evented, {
  /**
    The `location` property determines the type of URL's that your
    application will use.

    The following location types are currently available:

    * `hash`
    * `history`
    * `none`

    @property location
    @default 'hash'
    @see {Ember.Location}
  */
  location: 'hash',

  /**
   Represents the URL of the root of the application, often '/'. This prefix is
   assumed on all routes defined on this router.

   @property rootURL
   @default '/'
  */
  rootURL: '/',

  init: function() {
    this.router = this.constructor.router || this.constructor.map(Ember.K);
    this._activeViews = {};
    this._setupLocation();

    if (get(this, 'namespace.LOG_TRANSITIONS_INTERNAL')) {
      this.router.log = Ember.Logger.debug;
    }
  },

  /**
    Represents the current URL.

    @method url
    @returns {String} The current URL.
  */
  url: Ember.computed(function() {
    return get(this, 'location').getURL();
  }),

  /**
    Initializes the current router instance and sets up the change handling
    event listeners used by the instances `location` implementation.

    A property named `initialURL` will be used to determine the initial URL.
    If no value is found `/` will be used.

    @method startRouting
    @private
  */
  startRouting: function() {
    this.router = this.router || this.constructor.map(Ember.K);

    var router = this.router,
        location = get(this, 'location'),
        container = this.container,
        self = this,
        initialURL = get(this, 'initialURL');

    if (Ember.FEATURES.isEnabled("ember-routing-auto-location")) {
      // Allow the Location class to cancel the router setup while it refreshes
      // the page
      if (get(location, 'cancelRouterSetup')) {
        return;
      }
    }

    this._setupRouter(router, location);

    container.register('view:default', DefaultView);
    container.register('view:toplevel', Ember.View.extend());

    location.onUpdateURL(function(url) {
      self.handleURL(url);
    });

    if (typeof initialURL === "undefined") {
      initialURL = location.getURL();
    }

    this.handleURL(initialURL);
  },

  /**
    Handles updating the paths and notifying any listeners of the URL
    change.

    Triggers the router level `didTransition` hook.

    @method didTransition
    @private
  */
  didTransition: function(infos) {
    updatePaths(this);

    this._cancelLoadingEvent();

    this.notifyPropertyChange('url');

    // Put this in the runloop so url will be accurate. Seems
    // less surprising than didTransition being out of sync.
    Ember.run.once(this, this.trigger, 'didTransition');

    if (get(this, 'namespace').LOG_TRANSITIONS) {
      Ember.Logger.log("Transitioned into '" + Ember.Router._routePath(infos) + "'");
    }
  },

  handleURL: function(url) {
    return this._doTransition('handleURL', [url]);
  },

  transitionTo: function() {
    return this._doTransition('transitionTo', arguments);
  },

  intermediateTransitionTo: function() {
    this.router.intermediateTransitionTo.apply(this.router, arguments);

    updatePaths(this);

    var infos = this.router.currentHandlerInfos;
    if (get(this, 'namespace').LOG_TRANSITIONS) {
      Ember.Logger.log("Intermediate-transitioned into '" + Ember.Router._routePath(infos) + "'");
    }
  },

  replaceWith: function() {
    return this._doTransition('replaceWith', arguments);
  },

  generate: function() {
    var url = this.router.generate.apply(this.router, arguments);
    return this.location.formatURL(url);
  },

  /**
    Determines if the supplied route is currently active.

    @method isActive
    @param routeName
    @returns {Boolean}
    @private
  */
  isActive: function(routeName) {
    var router = this.router;
    return router.isActive.apply(router, arguments);
  },

  send: function(name, context) {
    this.router.trigger.apply(this.router, arguments);
  },

  /**
    Does this router instance have the given route.

    @method hasRoute
    @returns {Boolean}
    @private
  */
  hasRoute: function(route) {
    return this.router.hasRoute(route);
  },

  /**
    Resets the state of the router by clearing the current route
    handlers and deactivating them.

    @private
    @method reset
   */
  reset: function() {
    this.router.reset();
  },

  _lookupActiveView: function(templateName) {
    var active = this._activeViews[templateName];
    return active && active[0];
  },

  _connectActiveView: function(templateName, view) {
    var existing = this._activeViews[templateName];

    if (existing) {
      existing[0].off('willDestroyElement', this, existing[1]);
    }

    var disconnect = function() {
      delete this._activeViews[templateName];
    };

    this._activeViews[templateName] = [view, disconnect];
    view.one('willDestroyElement', this, disconnect);
  },

  _setupLocation: function() {
    var location = get(this, 'location'),
        rootURL = get(this, 'rootURL');

    if (rootURL && !this.container.has('-location-setting:root-url')) {
      this.container.register('-location-setting:root-url', rootURL, { instantiate: false });
    }

    if ('string' === typeof location && this.container) {
      var resolvedLocation = this.container.lookup('location:' + location);

      if ('undefined' !== typeof resolvedLocation) {
        location = set(this, 'location', resolvedLocation);
      } else {
        // Allow for deprecated registration of custom location API's
        var options = {implementation: location};

        location = set(this, 'location', Ember.Location.create(options));
      }
    }

    if (rootURL && typeof rootURL === 'string') {
      location.rootURL = rootURL;
    }

    // ensure that initState is called AFTER the rootURL is set on
    // the location instance
    if (typeof location.initState === 'function') { location.initState(); }
  },

  _getHandlerFunction: function() {
    var seen = {}, container = this.container,
        DefaultRoute = container.lookupFactory('route:basic'),
        self = this;

    return function(name) {
      var routeName = 'route:' + name,
          handler = container.lookup(routeName);

      if (seen[name]) { return handler; }

      seen[name] = true;

      if (!handler) {
        container.register(routeName, DefaultRoute.extend());
        handler = container.lookup(routeName);

        if (get(self, 'namespace.LOG_ACTIVE_GENERATION')) {
          Ember.Logger.info("generated -> " + routeName, { fullName: routeName });
        }
      }

      handler.routeName = name;
      return handler;
    };
  },

  _setupRouter: function(router, location) {
    var lastURL, emberRouter = this;

    router.getHandler = this._getHandlerFunction();

    var doUpdateURL = function() {
      location.setURL(lastURL);
    };

    router.updateURL = function(path) {
      lastURL = path;
      Ember.run.once(doUpdateURL);
    };

    if (location.replaceURL) {
      var doReplaceURL = function() {
        location.replaceURL(lastURL);
      };

      router.replaceURL = function(path) {
        lastURL = path;
        Ember.run.once(doReplaceURL);
      };
    }

    router.didTransition = function(infos) {
      emberRouter.didTransition(infos);
    };
  },

  _doTransition: function(method, args) {
    // Normalize blank route to root URL.
    args = slice.call(args);
    args[0] = args[0] || '/';

    var name = args[0], self = this,
      isQueryParamsOnly = false, queryParams;

    if (Ember.FEATURES.isEnabled("query-params-new")) {

      var possibleQueryParamArg = args[args.length - 1];
      if (possibleQueryParamArg && possibleQueryParamArg.hasOwnProperty('queryParams')) {
        if (args.length === 1) {
          isQueryParamsOnly = true;
          name = null;
        }
        queryParams = args[args.length - 1].queryParams;
      }
    }

    if (!isQueryParamsOnly && name.charAt(0) !== '/') {
      Ember.assert("The route " + name + " was not found", this.router.hasRoute(name));
    }

    if (queryParams) {
      // router.js expects queryParams to be passed in in
      // their final serialized form, so we need to translate.

      if (!name) {
        // Need to determine destination route name.
        var handlerInfos = this.router.activeTransition ?
                           this.router.activeTransition.state.handlerInfos :
                           this.router.state.handlerInfos;
        name = handlerInfos[handlerInfos.length - 1].name;
        args.unshift(name);
      }

      var qpMappings = this._queryParamNamesFor(name);


      Ember.Router._translateQueryParams(queryParams, qpMappings.translations, name);
      var value;
      for (var key in queryParams) {
        var descopedParam = Ember.Router._descopeQueryParam(key);
        if (key in qpMappings.queryParams) {
          value = queryParams[key];
          delete queryParams[key];
          queryParams[qpMappings.queryParams[key]] = value;
        } else if (descopedParam in qpMappings.validQueryParams) {
          value = queryParams[key];
          delete queryParams[key];
          queryParams[descopedParam] = value;
        }
      }
    }

    var transitionPromise = this.router[method].apply(this.router, args);

    transitionPromise.then(null, function(error) {
      if (error && error.name === "UnrecognizedURLError") {
        Ember.assert("The URL '" + error.message + "' did not match any routes in your application");
      }
    }, 'Ember: Check for Router unrecognized URL error');

    // We want to return the configurable promise object
    // so that callers of this function can use `.method()` on it,
    // which obviously doesn't exist for normal RSVP promises.
    return transitionPromise;
  },

  _scheduleLoadingEvent: function(transition, originRoute) {
    this._cancelLoadingEvent();
    this._loadingStateTimer = Ember.run.scheduleOnce('routerTransitions', this, '_fireLoadingEvent', transition, originRoute);
  },

  _fireLoadingEvent: function(transition, originRoute) {
    if (!this.router.activeTransition) {
      // Don't fire an event if we've since moved on from
      // the transition that put us in a loading state.
      return;
    }

    transition.trigger(true, 'loading', transition, originRoute);
  },

  _cancelLoadingEvent: function () {
    if (this._loadingStateTimer) {
      Ember.run.cancel(this._loadingStateTimer);
    }
    this._loadingStateTimer = null;
  },

  _queryParamNamesFor: function(routeName) {

    // TODO: add caching

    var handlerInfos = this.router.recognizer.handlersFor(routeName);
    var result = { queryParams: Ember.create(null), translations: Ember.create(null), validQueryParams: Ember.create(null) };
    var routerjs = this.router;
    forEach(handlerInfos, function(recogHandler) {
      var route = routerjs.getHandler(recogHandler.handler);
      getQueryParamsForRoute(route, result);
    });

    descopeQueryParams(result.queryParams);

    for (var k in result.queryParams) {
      result.validQueryParams[result.queryParams[k]] = true;
    }
    return result;
  },

  _queryParamNamesForSingle: function(routeName) {

    // TODO: add caching

    var result = { queryParams: Ember.create(null), translations: Ember.create(null) };
    var route = this.router.getHandler(routeName);

    getQueryParamsForRoute(route, result);

    // Descope non duplicate params.
    if (routeName !== 'application') {
      var allParams = this._queryParamNamesFor(routeName);
      for (var k in result.queryParams) {
        result.queryParams[k] = allParams.queryParams[k];
      }
    }

    return result;
  },

  /**
    @private

    Utility function for fetching all the current query params
    values from a controller.
   */
  _queryParamOverrides: function(results, queryParams, callback) {
    for (var name in queryParams) {
      var parts = name.split(':');

      var controller = controllerOrProtoFor(parts[0], this.container);
      Ember.assert(fmt("Could not lookup controller '%@' while setting up query params", [controller]), controller);

      // Now assign the final URL-serialized key-value pair,
      // e.g. "foo[propName]": "value"
      results[queryParams[name]] = get(controller, parts[1]);

      if (callback) {
        // Give callback a chance to override.
        callback(name, queryParams[name], name);
      }
    }
  }
});

/**
  @private
 */
function getQueryParamsForRoute(route, result) {
  var controllerName = route.controllerName || route.routeName,
      controller = controllerOrProtoFor(controllerName, route.container),
      queryParams = get(controller, 'queryParams');

  if (queryParams) {
    forEach(queryParams, function(propName) {

      var parts = propName.split(':');

      var urlKeyName;
      if (parts.length > 1) {
        urlKeyName = parts[1];
      } else {
        // TODO: use _queryParamScope here?
        if (controllerName !== 'application') {
          urlKeyName = controllerName + '[' + propName + ']';
        } else {
          urlKeyName = propName;
        }
      }

      var controllerFullname = controllerName + ':' + propName;

      result.queryParams[controllerFullname] = urlKeyName;
      result.translations[parts[0]] = controllerFullname;
    });
  }
}

function controllerOrProtoFor(controllerName, container) {
  var fullName = 'controller:' + controllerName;
  if (container.cache.has(fullName)) {
    return container.lookup(fullName);
  } else {
    // Controller hasn't been instantiated yet; just return its proto.
    var controllerClass = container.lookupFactory(fullName);
    if (controllerClass && typeof controllerClass.proto === 'function') {
      return controllerClass.proto();
    } else {
      return {};
    }
  }
}

function descopeQueryParams(params) {
  var paramCounts = {},
      descopedParam,
      k;

  // Loop through params and count the occurance of descoped param
  for (k in params) {
    descopedParam = Ember.Router._descopeQueryParam(params[k]);

    if (!paramCounts[descopedParam]) {
      paramCounts[descopedParam] = 1;
    } else {
      paramCounts[descopedParam] = paramCounts[descopedParam] + 1;
    }
  }

  // Loop through again descoping params if the descoped key only occurs once
  for (k in params) {
    descopedParam = Ember.Router._descopeQueryParam(params[k]);

    if (paramCounts[descopedParam] === 1) {
      params[k] = descopedParam;
    }
  }
}

/**
  Helper function for iterating root-ward, starting
  from (but not including) the provided `originRoute`.

  Returns true if the last callback fired requested
  to bubble upward.

  @private
 */
function forEachRouteAbove(originRoute, transition, callback) {
  var handlerInfos = transition.state.handlerInfos,
      originRouteFound = false;

  for (var i = handlerInfos.length - 1; i >= 0; --i) {
    var handlerInfo = handlerInfos[i],
        route = handlerInfo.handler;

    if (!originRouteFound) {
      if (originRoute === route) {
        originRouteFound = true;
      }
      continue;
    }

    if (callback(route, handlerInfos[i + 1].handler) !== true) {
      return false;
    }
  }
  return true;
}

// These get invoked when an action bubbles above ApplicationRoute
// and are not meant to be overridable.
var defaultActionHandlers = {

  willResolveModel: function(transition, originRoute) {
    originRoute.router._scheduleLoadingEvent(transition, originRoute);
  },

  error: function(error, transition, originRoute) {
    // Attempt to find an appropriate error substate to enter.
    var router = originRoute.router;

    var tryTopLevel = forEachRouteAbove(originRoute, transition, function(route, childRoute) {
      var childErrorRouteName = findChildRouteName(route, childRoute, 'error');
      if (childErrorRouteName) {
        router.intermediateTransitionTo(childErrorRouteName, error);
        return;
      }
      return true;
    });

    if (tryTopLevel) {
      // Check for top-level error state to enter.
      if (routeHasBeenDefined(originRoute.router, 'application_error')) {
        router.intermediateTransitionTo('application_error', error);
        return;
      }
    } else {
      // Don't fire an assertion if we found an error substate.
      return;
    }

    Ember.Logger.error('Error while loading route: ' + (error && error.stack));
  },

  loading: function(transition, originRoute) {
    // Attempt to find an appropriate loading substate to enter.
    var router = originRoute.router;

    var tryTopLevel = forEachRouteAbove(originRoute, transition, function(route, childRoute) {
      var childLoadingRouteName = findChildRouteName(route, childRoute, 'loading');

      if (childLoadingRouteName) {
        router.intermediateTransitionTo(childLoadingRouteName);
        return;
      }

      // Don't bubble above pivot route.
      if (transition.pivotHandler !== route) {
        return true;
      }
    });

    if (tryTopLevel) {
      // Check for top-level loading state to enter.
      if (routeHasBeenDefined(originRoute.router, 'application_loading')) {
        router.intermediateTransitionTo('application_loading');
        return;
      }
    }
  }
};

function findChildRouteName(parentRoute, originatingChildRoute, name) {
  var router = parentRoute.router,
      childName,
      targetChildRouteName = originatingChildRoute.routeName.split('.').pop(),
      namespace = parentRoute.routeName === 'application' ? '' : parentRoute.routeName + '.';

  if (Ember.FEATURES.isEnabled("ember-routing-named-substates")) {
    // First, try a named loading state, e.g. 'foo_loading'
    childName = namespace + targetChildRouteName + '_' + name;
    if (routeHasBeenDefined(router, childName)) {
      return childName;
    }
  }

  // Second, try general loading state, e.g. 'loading'
  childName = namespace + name;
  if (routeHasBeenDefined(router, childName)) {
    return childName;
  }
}

function routeHasBeenDefined(router, name) {
  var container = router.container;
  return router.hasRoute(name) &&
         (container.has('template:' + name) || container.has('route:' + name));
}

function triggerEvent(handlerInfos, ignoreFailure, args) {
  var name = args.shift();

  if (!handlerInfos) {
    if (ignoreFailure) { return; }
    throw new Ember.Error("Can't trigger action '" + name + "' because your app hasn't finished transitioning into its first route. To trigger an action on destination routes during a transition, you can call `.send()` on the `Transition` object passed to the `model/beforeModel/afterModel` hooks.");
  }

  var eventWasHandled = false;

  for (var i = handlerInfos.length - 1; i >= 0; i--) {
    var handlerInfo = handlerInfos[i],
        handler = handlerInfo.handler;

    if (handler._actions && handler._actions[name]) {
      if (handler._actions[name].apply(handler, args) === true) {
        eventWasHandled = true;
      } else {
        return;
      }
    }
  }

  if (defaultActionHandlers[name]) {
    defaultActionHandlers[name].apply(null, args);
    return;
  }

  if (!eventWasHandled && !ignoreFailure) {
    throw new Ember.Error("Nothing handled the action '" + name + "'. If you did handle the action, this error can be caused by returning true from an action handler in a controller, causing the action to bubble.");
  }
}

function updatePaths(router) {
  var appController = router.container.lookup('controller:application');

  if (!appController) {
    // appController might not exist when top-level loading/error
    // substates have been entered since ApplicationRoute hasn't
    // actually been entered at that point.
    return;
  }

  var infos = router.router.currentHandlerInfos,
      path = Ember.Router._routePath(infos);

  if (!('currentPath' in appController)) {
    defineProperty(appController, 'currentPath');
  }

  set(appController, 'currentPath', path);

  if (!('currentRouteName' in appController)) {
    defineProperty(appController, 'currentRouteName');
  }

  set(appController, 'currentRouteName', infos[infos.length - 1].name);
}

Ember.Router.reopenClass({
  router: null,
  map: function(callback) {
    var router = this.router;
    if (!router) {
      router = new Router();
      router.callbacks = [];
      router.triggerEvent = triggerEvent;
      this.reopenClass({ router: router });
    }

    var dsl = Ember.RouterDSL.map(function() {
      this.resource('application', { path: "/" }, function() {
        for (var i=0; i < router.callbacks.length; i++) {
          router.callbacks[i].call(this);
        }
        callback.call(this);
      });
    });

    router.callbacks.push(callback);
    router.map(dsl.generate());
    return router;
  },

  _routePath: function(handlerInfos) {
    var path = [];

    // We have to handle coalescing resource names that
    // are prefixed with their parent's names, e.g.
    // ['foo', 'foo.bar.baz'] => 'foo.bar.baz', not 'foo.foo.bar.baz'

    function intersectionMatches(a1, a2) {
      for (var i = 0, len = a1.length; i < len; ++i) {
        if (a1[i] !== a2[i]) {
          return false;
        }
      }
      return true;
    }

    for (var i=1, l=handlerInfos.length; i<l; i++) {
      var name = handlerInfos[i].name,
          nameParts = name.split("."),
          oldNameParts = slice.call(path);

      while (oldNameParts.length) {
        if (intersectionMatches(oldNameParts, nameParts)) {
          break;
        }
        oldNameParts.shift();
      }

      path.push.apply(path, nameParts.slice(oldNameParts.length));
    }

    return path.join(".");
  },

  _translateQueryParams: function(queryParams, translations, routeName) {
    for (var name in queryParams) {
      if (!queryParams.hasOwnProperty(name)) { continue; }

      if (name in translations) {
        queryParams[translations[name]] = queryParams[name];
        delete queryParams[name];
      } else {
        Ember.assert(fmt("You supplied an unknown query param controller property '%@' for route '%@'. Only the following query param properties can be set for this route: %@", [name, routeName, Ember.keys(translations)]), name in queryParams);
      }
    }
  },

  _descopeQueryParam: function(param) {
    var regex = /\[(.+)\]/,
        result = param.match(regex);

    if (!result) {
      result = param;
    } else {
      result = result[1];
    }

    return result;
  }
});



})();



(function() {
/**
@module ember
@submodule ember-routing
*/

var get = Ember.get, set = Ember.set,
    getProperties = Ember.getProperties,
    classify = Ember.String.classify,
    fmt = Ember.String.fmt,
    a_forEach = Ember.EnumerableUtils.forEach,
    a_replace = Ember.EnumerableUtils.replace;


/**
  The `Ember.Route` class is used to define individual routes. Refer to
  the [routing guide](http://emberjs.com/guides/routing/) for documentation.

  @class Route
  @namespace Ember
  @extends Ember.Object
  @uses Ember.ActionHandler
*/
Ember.Route = Ember.Object.extend(Ember.ActionHandler, {

  /**
    @private

    @method exit
  */
  exit: function() {
    if (Ember.FEATURES.isEnabled("query-params-new")) {
      this.controller._deactivateQueryParamObservers();
    }
    this.deactivate();
    this.teardownViews();
  },

  /**
    @private

    @method enter
  */
  enter: function() {
    this.activate();
  },

  /**
    The name of the view to use by default when rendering this routes template.

    When rendering a template, the route will, by default, determine the
    template and view to use from the name of the route itself. If you need to
    define a specific view, set this property.

    This is useful when multiple routes would benefit from using the same view
    because it doesn't require a custom `renderTemplate` method. For example,
    the following routes will all render using the `App.PostsListView` view:

    ```js
    var PostsList = Ember.Route.extend({
      viewName: 'postsList',
    });

    App.PostsIndexRoute = PostsList.extend();
    App.PostsArchivedRoute = PostsList.extend();
    ```

    @property viewName
    @type String
    @default null
  */
  viewName: null,

  /**
    The name of the template to use by default when rendering this routes
    template.

    This is similar with `viewName`, but is useful when you just want a custom
    template without a view.

    ```js
    var PostsList = Ember.Route.extend({
      templateName: 'posts/list'
    });

    App.PostsIndexRoute = PostsList.extend();
    App.PostsArchivedRoute = PostsList.extend();
    ```

    @property templateName
    @type String
    @default null
  */
  templateName: null,

  /**
    The name of the controller to associate with this route.

    By default, Ember will lookup a route's controller that matches the name
    of the route (i.e. `App.PostController` for `App.PostRoute`). However,
    if you would like to define a specific controller to use, you can do so
    using this property.

    This is useful in many ways, as the controller specified will be:

    * passed to the `setupController` method.
    * used as the controller for the view being rendered by the route.
    * returned from a call to `controllerFor` for the route.

    @property controllerName
    @type String
    @default null
  */
  controllerName: null,

  /**
    The collection of functions, keyed by name, available on this route as
    action targets.

    These functions will be invoked when a matching `{{action}}` is triggered
    from within a template and the application's current route is this route.

    Actions can also be invoked from other parts of your application via `Route#send`
    or `Controller#send`.

    The `actions` hash will inherit action handlers from
    the `actions` hash defined on extended Route parent classes
    or mixins rather than just replace the entire hash, e.g.:

    ```js
    App.CanDisplayBanner = Ember.Mixin.create({
      actions: {
        displayBanner: function(msg) {
          // ...
        }
      }
    });

    App.WelcomeRoute = Ember.Route.extend(App.CanDisplayBanner, {
      actions: {
        playMusic: function() {
          // ...
        }
      }
    });

    // `WelcomeRoute`, when active, will be able to respond
    // to both actions, since the actions hash is merged rather
    // then replaced when extending mixins / parent classes.
    this.send('displayBanner');
    this.send('playMusic');
    ```

    Within a route's action handler, the value of the `this` context
    is the Route object:

    ```js
    App.SongRoute = Ember.Route.extend({
      actions: {
        myAction: function() {
          this.controllerFor("song");
          this.transitionTo("other.route");
          ...
        }
      }
    });
    ```

    It is also possible to call `this._super()` from within an
    action handler if it overrides a handler defined on a parent
    class or mixin:

    Take for example the following routes:

    ```js
    App.DebugRoute = Ember.Mixin.create({
      actions: {
        debugRouteInformation: function() {
          console.debug("trololo");
        }
      }
    });

    App.AnnoyingDebugRoute = Ember.Route.extend(App.DebugRoute, {
      actions: {
        debugRouteInformation: function() {
          // also call the debugRouteInformation of mixed in App.DebugRoute
          this._super();

          // show additional annoyance
          window.alert(...);
        }
      }
    });
    ```

    ## Bubbling

    By default, an action will stop bubbling once a handler defined
    on the `actions` hash handles it. To continue bubbling the action,
    you must return `true` from the handler:

    ```js
    App.Router.map(function() {
      this.resource("album", function() {
        this.route("song");
      });
    });

    App.AlbumRoute = Ember.Route.extend({
      actions: {
        startPlaying: function() {
        }
      }
    });

    App.AlbumSongRoute = Ember.Route.extend({
      actions: {
        startPlaying: function() {
          // ...

          if (actionShouldAlsoBeTriggeredOnParentRoute) {
            return true;
          }
        }
      }
    });
    ```

    ## Built-in actions

    There are a few built-in actions pertaining to transitions that you
    can use to customize transition behavior: `willTransition` and
    `error`.

    ### `willTransition`

    The `willTransition` action is fired at the beginning of any
    attempted transition with a `Transition` object as the sole
    argument. This action can be used for aborting, redirecting,
    or decorating the transition from the currently active routes.

    A good example is preventing navigation when a form is
    half-filled out:

    ```js
    App.ContactFormRoute = Ember.Route.extend({
      actions: {
        willTransition: function(transition) {
          if (this.controller.get('userHasEnteredData')) {
            this.controller.displayNavigationConfirm();
            transition.abort();
          }
        }
      }
    });
    ```

    You can also redirect elsewhere by calling
    `this.transitionTo('elsewhere')` from within `willTransition`.
    Note that `willTransition` will not be fired for the
    redirecting `transitionTo`, since `willTransition` doesn't
    fire when there is already a transition underway. If you want
    subsequent `willTransition` actions to fire for the redirecting
    transition, you must first explicitly call
    `transition.abort()`.

    ### `error`

    When attempting to transition into a route, any of the hooks
    may return a promise that rejects, at which point an `error`
    action will be fired on the partially-entered routes, allowing
    for per-route error handling logic, or shared error handling
    logic defined on a parent route.

    Here is an example of an error handler that will be invoked
    for rejected promises from the various hooks on the route,
    as well as any unhandled errors from child routes:

    ```js
    App.AdminRoute = Ember.Route.extend({
      beforeModel: function() {
        return Ember.RSVP.reject("bad things!");
      },

      actions: {
        error: function(error, transition) {
          // Assuming we got here due to the error in `beforeModel`,
          // we can expect that error === "bad things!",
          // but a promise model rejecting would also
          // call this hook, as would any errors encountered
          // in `afterModel`.

          // The `error` hook is also provided the failed
          // `transition`, which can be stored and later
          // `.retry()`d if desired.

          this.transitionTo('login');
        }
      }
    });
    ```

    `error` actions that bubble up all the way to `ApplicationRoute`
    will fire a default error handler that logs the error. You can
    specify your own global default error handler by overriding the
    `error` handler on `ApplicationRoute`:

    ```js
    App.ApplicationRoute = Ember.Route.extend({
      actions: {
        error: function(error, transition) {
          this.controllerFor('banner').displayError(error.message);
        }
      }
    });
    ```

    @property actions
    @type Hash
    @default null
  */
  _actions: {
    finalizeQueryParamChange: function(params, finalParams) {
      if (Ember.FEATURES.isEnabled("query-params-new")) {
        // In this hook we receive a list of raw URL query
        // param changes. We need to take any

        var controller = this.controller;
        var changes = controller._queryParamChangesDuringSuspension;
        var queryParams = get(controller, '_queryParamHash');

        // Loop through all the query params that
        // this controller knows about.
        for (var k in queryParams) {
          if (queryParams.hasOwnProperty(k)) {

            var key = false,
                descopedKey = Ember.Router._descopeQueryParam(k);

            if (queryParams[k] in params) {
              key = queryParams[k];
            } else if (params[descopedKey] !== undefined) {
              key = descopedKey;
            }

            // Do a reverse lookup to see if the changed query
            // param URL key corresponds to a QP property on
            // this controller.
            if (key) {
              // Update this controller property in a way that
              // won't fire observers.
              controller._finalizingQueryParams = true;
              if (!changes || !(k in changes)) {
                // Only update the controller if the query param
                // value wasn't overriden in setupController.

                // Arrays coming from router.js should be Emberized.
                var newValue = params[key];
                newValue = Ember.isArray(newValue) ? Ember.A(newValue) : newValue;
                set(controller, k, newValue);
              }
              controller._finalizingQueryParams = false;

              // Delete from params so that child routes
              // don't also try to respond to changes to
              // non-fully-qualified query param name changes.
              delete params[key];
            }

            // Query params are ordered. This action bubbles up
            // the route hierarchy so we unshift so that the final
            // order of query params goes from root to leaf.
            var param = {
              longform: queryParams[k],
              shortform: descopedKey,
              value: Ember.copy(get(controller, k))
            };

            var useLongform = false;

            for (var i = 0, l = finalParams.length; i < l; i++) {
              if (finalParams[i].key === descopedKey) {
                useLongform = true;
                finalParams[i].key = finalParams[i].longform;
              }
            }

            param.key = useLongform ? queryParams[k] : descopedKey;

            finalParams.unshift(param);
          }
        }
        controller._queryParamChangesDuringSuspension = null;

        // Bubble so that parent routes can claim QPs.
        return true;
      }
    }
  },

  /**
    @deprecated

    Please use `actions` instead.
    @method events
  */
  events: null,

  mergedProperties: ['events'],

  /**
    This hook is executed when the router completely exits this route. It is
    not executed when the model for the route changes.

    @method deactivate
  */
  deactivate: Ember.K,

  /**
    This hook is executed when the router enters the route. It is not executed
    when the model for the route changes.

    @method activate
  */
  activate: Ember.K,

  /**
    Transition the application into another route. The route may
    be either a single route or route path:

    ```javascript
    this.transitionTo('blogPosts');
    this.transitionTo('blogPosts.recentEntries');
    ```

    Optionally supply a model for the route in question. The model
    will be serialized into the URL using the `serialize` hook of
    the route:

    ```javascript
    this.transitionTo('blogPost', aPost);
    ```

    If a literal is passed (such as a number or a string), it will
    be treated as an identifier instead. In this case, the `model`
    hook of the route will be triggered:

    ```javascript
    this.transitionTo('blogPost', 1);
    ```

    Multiple models will be applied last to first recursively up the
    resource tree.

    ```javascript
    App.Router.map(function() {
      this.resource('blogPost', {path:':blogPostId'}, function(){
        this.resource('blogComment', {path: ':blogCommentId'});
      });
    });
    
    this.transitionTo('blogComment', aPost, aComment);
    this.transitionTo('blogComment', 1, 13);
    ```

    It is also possible to pass a URL (a string that starts with a
    `/`). This is intended for testing and debugging purposes and
    should rarely be used in production code.

    ```javascript
    this.transitionTo('/');
    this.transitionTo('/blog/post/1/comment/13');
    ```

    See also 'replaceWith'.

    Simple Transition Example

    ```javascript
    App.Router.map(function() {
      this.route("index");
      this.route("secret");
      this.route("fourOhFour", { path: "*:"});
    });

    App.IndexRoute = Ember.Route.extend({
      actions: {
        moveToSecret: function(context){
          if (authorized()){
            this.transitionTo('secret', context);
          }
            this.transitionTo('fourOhFour');
        }
      }
    });
    ```

    Transition to a nested route

    ```javascript
    App.Router.map(function() {
      this.resource('articles', { path: '/articles' }, function() {
        this.route('new');
      });
    });

    App.IndexRoute = Ember.Route.extend({
      actions: {
        transitionToNewArticle: function() {
          this.transitionTo('articles.new');
        }
      }
    });
    ```

    Multiple Models Example

    ```javascript
    App.Router.map(function() {
      this.route("index");
      this.resource('breakfast', {path:':breakfastId'}, function(){
        this.resource('cereal', {path: ':cerealId'});
      });
    });

    App.IndexRoute = Ember.Route.extend({
      actions: {
        moveToChocolateCereal: function(){
          var cereal = { cerealId: "ChocolateYumminess"},
              breakfast = {breakfastId: "CerealAndMilk"};

          this.transitionTo('cereal', breakfast, cereal);
        }
      }
    });
    ```

    @method transitionTo
    @param {String} name the name of the route or a URL
    @param {...Object} models the model(s) or identifier(s) to be used while
      transitioning to the route.
    @return {Transition} the transition object associated with this
      attempted transition
  */
  transitionTo: function(name, context) {
    var router = this.router;
    return router.transitionTo.apply(router, arguments);
  },

  /**
    Perform a synchronous transition into another route without attempting
    to resolve promises, update the URL, or abort any currently active
    asynchronous transitions (i.e. regular transitions caused by
    `transitionTo` or URL changes).

    This method is handy for performing intermediate transitions on the
    way to a final destination route, and is called internally by the
    default implementations of the `error` and `loading` handlers.

    @method intermediateTransitionTo
    @param {String} name the name of the route
    @param {...Object} models the model(s) to be used while transitioning
    to the route.
   */
  intermediateTransitionTo: function() {
    var router = this.router;
    router.intermediateTransitionTo.apply(router, arguments);
  },

  /**
    Refresh the model on this route and any child routes, firing the
    `beforeModel`, `model`, and `afterModel` hooks in a similar fashion
    to how routes are entered when transitioning in from other route.
    The current route params (e.g. `article_id`) will be passed in
    to the respective model hooks, and if a different model is returned,
    `setupController` and associated route hooks will re-fire as well.

    An example usage of this method is re-querying the server for the
    latest information using the same parameters as when the route
    was first entered.

    Note that this will cause `model` hooks to fire even on routes
    that were provided a model object when the route was initially
    entered.

    @method refresh
    @return {Transition} the transition object associated with this
      attempted transition
   */
  refresh: function() {
    return this.router.router.refresh(this).method('replace');
  },

  /**
    Transition into another route while replacing the current URL, if possible.
    This will replace the current history entry instead of adding a new one.
    Beside that, it is identical to `transitionTo` in all other respects. See
    'transitionTo' for additional information regarding multiple models.

    Example

    ```javascript
    App.Router.map(function() {
      this.route("index");
      this.route("secret");
    });

    App.SecretRoute = Ember.Route.extend({
      afterModel: function() {
        if (!authorized()){
          this.replaceWith('index');
        }
      }
    });
    ```

    @method replaceWith
    @param {String} name the name of the route or a URL
    @param {...Object} models the model(s) or identifier(s) to be used while
      transitioning to the route.
    @return {Transition} the transition object associated with this
      attempted transition
  */
  replaceWith: function() {
    var router = this.router;
    return router.replaceWith.apply(router, arguments);
  },

  /**
    Sends an action to the router, which will delegate it to the currently
    active route hierarchy per the bubbling rules explained under `actions`.

    Example

    ```javascript
    App.Router.map(function() {
      this.route("index");
    });

    App.ApplicationRoute = Ember.Route.extend({
      actions: {
        track: function(arg) {
          console.log(arg, 'was clicked');
        }
      }
    });

    App.IndexRoute = Ember.Route.extend({
      actions: {
        trackIfDebug: function(arg) {
          if (debug) {
            this.send('track', arg);
          }
        }
      }
    });
    ```

    @method send
    @param {String} name the name of the action to trigger
    @param {...*} args
  */
  send: function() {
    return this.router.send.apply(this.router, arguments);
  },

  /**
    This hook is the entry point for router.js

    @private
    @method setup
  */
  setup: function(context, transition) {
    var controllerName = this.controllerName || this.routeName,
        controller = this.controllerFor(controllerName, true);
    if (!controller) {
      controller =  this.generateController(controllerName, context);
    }

    // Assign the route's controller so that it can more easily be
    // referenced in action handlers
    this.controller = controller;

    if (Ember.FEATURES.isEnabled("query-params-new")) {
      // TODO: configurable _queryParamScope
      if (controllerName !== 'application') {
        this.controller._queryParamScope = controllerName;
      }
      this.controller._activateQueryParamObservers();
    }

    if (this.setupControllers) {
      Ember.deprecate("Ember.Route.setupControllers is deprecated. Please use Ember.Route.setupController(controller, model) instead.");
      this.setupControllers(controller, context);
    } else {

      if (Ember.FEATURES.isEnabled("query-params-new")) {
        // Prevent updates to query params in setupController
        // from firing another transition. Updating QPs in
        // setupController will only affect the final
        // generated URL.
        controller._finalizingQueryParams = true;
        controller._queryParamChangesDuringSuspension = {};
        this.setupController(controller, context, transition);
        controller._finalizingQueryParams = false;
      } else {
        this.setupController(controller, context);
      }
    }

    if (this.renderTemplates) {
      Ember.deprecate("Ember.Route.renderTemplates is deprecated. Please use Ember.Route.renderTemplate(controller, model) instead.");
      this.renderTemplates(context);
    } else {
      this.renderTemplate(controller, context);
    }
  },

  /**
    This hook is the first of the route entry validation hooks
    called when an attempt is made to transition into a route
    or one of its children. It is called before `model` and
    `afterModel`, and is appropriate for cases when:

    1) A decision can be made to redirect elsewhere without
       needing to resolve the model first.
    2) Any async operations need to occur first before the
       model is attempted to be resolved.

    This hook is provided the current `transition` attempt
    as a parameter, which can be used to `.abort()` the transition,
    save it for a later `.retry()`, or retrieve values set
    on it from a previous hook. You can also just call
    `this.transitionTo` to another route to implicitly
    abort the `transition`.

    You can return a promise from this hook to pause the
    transition until the promise resolves (or rejects). This could
    be useful, for instance, for retrieving async code from
    the server that is required to enter a route.

    ```js
    App.PostRoute = Ember.Route.extend({
      beforeModel: function(transition) {
        if (!App.Post) {
          return Ember.$.getScript('/models/post.js');
        }
      }
    });
    ```

    If `App.Post` doesn't exist in the above example,
    `beforeModel` will use jQuery's `getScript`, which
    returns a promise that resolves after the server has
    successfully retrieved and executed the code from the
    server. Note that if an error were to occur, it would
    be passed to the `error` hook on `Ember.Route`, but
    it's also possible to handle errors specific to
    `beforeModel` right from within the hook (to distinguish
    from the shared error handling behavior of the `error`
    hook):

    ```js
    App.PostRoute = Ember.Route.extend({
      beforeModel: function(transition) {
        if (!App.Post) {
          var self = this;
          return Ember.$.getScript('post.js').then(null, function(e) {
            self.transitionTo('help');

            // Note that the above transitionTo will implicitly
            // halt the transition. If you were to return
            // nothing from this promise reject handler,
            // according to promise semantics, that would
            // convert the reject into a resolve and the
            // transition would continue. To propagate the
            // error so that it'd be handled by the `error`
            // hook, you would have to either
            return Ember.RSVP.reject(e);
          });
        }
      }
    });
    ```

    @method beforeModel
    @param {Transition} transition
    @param {Object} queryParams the active query params for this route
    @return {Promise} if the value returned from this hook is
      a promise, the transition will pause until the transition
      resolves. Otherwise, non-promise return values are not
      utilized in any way.
  */
  beforeModel: Ember.K,

  /**
    This hook is called after this route's model has resolved.
    It follows identical async/promise semantics to `beforeModel`
    but is provided the route's resolved model in addition to
    the `transition`, and is therefore suited to performing
    logic that can only take place after the model has already
    resolved.

    ```js
    App.PostsRoute = Ember.Route.extend({
      afterModel: function(posts, transition) {
        if (posts.length === 1) {
          this.transitionTo('post.show', posts[0]);
        }
      }
    });
    ```

    Refer to documentation for `beforeModel` for a description
    of transition-pausing semantics when a promise is returned
    from this hook.

    @method afterModel
    @param {Object} resolvedModel the value returned from `model`,
      or its resolved value if it was a promise
    @param {Transition} transition
    @param {Object} queryParams the active query params for this handler
    @return {Promise} if the value returned from this hook is
      a promise, the transition will pause until the transition
      resolves. Otherwise, non-promise return values are not
      utilized in any way.
   */
  afterModel: Ember.K,

  /**
    A hook you can implement to optionally redirect to another route.

    If you call `this.transitionTo` from inside of this hook, this route
    will not be entered in favor of the other hook.

    `redirect` and `afterModel` behave very similarly and are
    called almost at the same time, but they have an important
    distinction in the case that, from one of these hooks, a
    redirect into a child route of this route occurs: redirects
    from `afterModel` essentially invalidate the current attempt
    to enter this route, and will result in this route's `beforeModel`,
    `model`, and `afterModel` hooks being fired again within
    the new, redirecting transition. Redirects that occur within
    the `redirect` hook, on the other hand, will _not_ cause
    these hooks to be fired again the second time around; in
    other words, by the time the `redirect` hook has been called,
    both the resolved model and attempted entry into this route
    are considered to be fully validated.

    @method redirect
    @param {Object} model the model for this route
  */
  redirect: Ember.K,

  /**
    Called when the context is changed by router.js.

    @private
    @method contextDidChange
  */
  contextDidChange: function() {
    this.currentModel = this.context;
  },

  /**
    A hook you can implement to convert the URL into the model for
    this route.

    ```js
    App.Router.map(function() {
      this.resource('post', {path: '/posts/:post_id'});
    });
    ```

    The model for the `post` route is `App.Post.find(params.post_id)`.

    By default, if your route has a dynamic segment ending in `_id`:

    * The model class is determined from the segment (`post_id`'s
      class is `App.Post`)
    * The find method is called on the model class with the value of
      the dynamic segment.

    Note that for routes with dynamic segments, this hook is only
    executed when entered via the URL. If the route is entered
    through a transition (e.g. when using the `link-to` Handlebars
    helper), then a model context is already provided and this hook
    is not called. Routes without dynamic segments will always
    execute the model hook.

    This hook follows the asynchronous/promise semantics
    described in the documentation for `beforeModel`. In particular,
    if a promise returned from `model` fails, the error will be
    handled by the `error` hook on `Ember.Route`.

    Example

    ```js
    App.PostRoute = Ember.Route.extend({
      model: function(params) {
        return App.Post.find(params.post_id);
      }
    });
    ```

    @method model
    @param {Object} params the parameters extracted from the URL
    @param {Transition} transition
    @param {Object} queryParams the query params for this route
    @return {Object|Promise} the model for this route. If
      a promise is returned, the transition will pause until
      the promise resolves, and the resolved value of the promise
      will be used as the model for this route.
  */
  model: function(params, transition) {
    var match, name, sawParams, value;

    for (var prop in params) {
      if (prop === 'queryParams') { continue; }

      if (match = prop.match(/^(.*)_id$/)) {
        name = match[1];
        value = params[prop];
      }
      sawParams = true;
    }

    if (!name && sawParams) { return Ember.copy(params); }
    else if (!name) {
      if (Ember.FEATURES.isEnabled("ember-routing-inherits-parent-model")) {
        if (transition.resolveIndex !== transition.state.handlerInfos.length-1) { return; }

        var parentModel = transition.state.handlerInfos[transition.resolveIndex-1].context;

        return parentModel;
      } else {
        return;
      }
    }

    return this.findModel(name, value);
  },

  /**
    @private

    Router.js hook.
   */
  deserialize: function(params, transition) {
    if (Ember.FEATURES.isEnabled("query-params-new")) {
      return this.model(this.paramsFor(this.routeName), transition);
    } else {
      return this.model(params, transition);
    }
  },

  /**

    @method findModel
    @param {String} type the model type
    @param {Object} value the value passed to find
  */
  findModel: function(){
    var store = get(this, 'store');
    return store.find.apply(store, arguments);
  },

  /**
    Store property provides a hook for data persistence libraries to inject themselves.

    By default, this store property provides the exact same functionality previously
    in the model hook.

    Currently, the required interface is:

    `store.find(modelName, findArguments)`

    @method store
    @param {Object} store
  */
  store: Ember.computed(function(){
    var container = this.container;
    var routeName = this.routeName;
    var namespace = get(this, 'router.namespace');

    return {
      find: function(name, value) {
        var modelClass = container.lookupFactory('model:' + name);

        Ember.assert("You used the dynamic segment " + name + "_id in your route " +
                     routeName + ", but " + namespace + "." + classify(name) +
                     " did not exist and you did not override your route's `model` " +
                     "hook.", modelClass);

        if (!modelClass) { return; }

        Ember.assert(classify(name) + ' has no method `find`.', typeof modelClass.find === 'function');

        return modelClass.find(value);
      }
    };
  }),

  /**
    A hook you can implement to convert the route's model into parameters
    for the URL.

    ```js
    App.Router.map(function() {
      this.resource('post', {path: '/posts/:post_id'});
    });

    App.PostRoute = Ember.Route.extend({
      model: function(params) {
        // the server returns `{ id: 12 }`
        return jQuery.getJSON("/posts/" + params.post_id);
      },

      serialize: function(model) {
        // this will make the URL `/posts/12`
        return { post_id: model.id };
      }
    });
    ```

    The default `serialize` method will insert the model's `id` into the
    route's dynamic segment (in this case, `:post_id`) if the segment contains '_id'.
    If the route has multiple dynamic segments or does not contain '_id', `serialize`
    will return `Ember.getProperties(model, params)`

    This method is called when `transitionTo` is called with a context
    in order to populate the URL.

    @method serialize
    @param {Object} model the route's model
    @param {Array} params an Array of parameter names for the current
      route (in the example, `['post_id']`.
    @return {Object} the serialized parameters
  */
  serialize: function(model, params) {
    if (params.length < 1) { return; }
    if (!model) { return; }

    var name = params[0], object = {};

    if (/_id$/.test(name) && params.length === 1) {
      object[name] = get(model, "id");
    } else {
      object = getProperties(model, params);
    }

    return object;
  },

  /**
    A hook you can use to setup the controller for the current route.

    This method is called with the controller for the current route and the
    model supplied by the `model` hook.

    By default, the `setupController` hook sets the `content` property of
    the controller to the `model`.

    If you implement the `setupController` hook in your Route, it will
    prevent this default behavior. If you want to preserve that behavior
    when implementing your `setupController` function, make sure to call
    `_super`:

    ```js
    App.PhotosRoute = Ember.Route.extend({
      model: function() {
        return App.Photo.find();
      },

      setupController: function (controller, model) {
        // Call _super for default behavior
        this._super(controller, model);
        // Implement your custom setup after
        this.controllerFor('application').set('showingPhotos', true);
      }
    });
    ```

    This means that your template will get a proxy for the model as its
    context, and you can act as though the model itself was the context.

    The provided controller will be one resolved based on the name
    of this route.

    If no explicit controller is defined, Ember will automatically create
    an appropriate controller for the model.

    * if the model is an `Ember.Array` (including record arrays from Ember
      Data), the controller is an `Ember.ArrayController`.
    * otherwise, the controller is an `Ember.ObjectController`.

    As an example, consider the router:

    ```js
    App.Router.map(function() {
      this.resource('post', {path: '/posts/:post_id'});
    });
    ```

    For the `post` route, a controller named `App.PostController` would
    be used if it is defined. If it is not defined, an `Ember.ObjectController`
    instance would be used.

    Example

    ```js
    App.PostRoute = Ember.Route.extend({
      setupController: function(controller, model) {
        controller.set('model', model);
      }
    });
    ```

    @method setupController
    @param {Controller} controller instance
    @param {Object} model
  */
  setupController: function(controller, context, transition) {
    if (controller && (context !== undefined)) {
      set(controller, 'model', context);
    }
  },

  /**
    Returns the controller for a particular route or name.

    The controller instance must already have been created, either through entering the
    associated route or using `generateController`.

    ```js
    App.PostRoute = Ember.Route.extend({
      setupController: function(controller, post) {
        this._super(controller, post);
        this.controllerFor('posts').set('currentPost', post);
      }
    });
    ```

    @method controllerFor
    @param {String} name the name of the route or controller
    @return {Ember.Controller}
  */
  controllerFor: function(name, _skipAssert) {
    var container = this.container,
        route = container.lookup('route:'+name),
        controller;

    if (route && route.controllerName) {
      name = route.controllerName;
    }

    controller = container.lookup('controller:' + name);

    // NOTE: We're specifically checking that skipAssert is true, because according
    //   to the old API the second parameter was model. We do not want people who
    //   passed a model to skip the assertion.
    Ember.assert("The controller named '"+name+"' could not be found. Make sure " +
                 "that this route exists and has already been entered at least " +
                 "once. If you are accessing a controller not associated with a " +
                 "route, make sure the controller class is explicitly defined.",
                 controller || _skipAssert === true);

    return controller;
  },

  /**
    Generates a controller for a route.

    If the optional model is passed then the controller type is determined automatically,
    e.g., an ArrayController for arrays.

    Example

    ```js
    App.PostRoute = Ember.Route.extend({
      setupController: function(controller, post) {
        this._super(controller, post);
        this.generateController('posts', post);
      }
    });
    ```

    @method generateController
    @param {String} name the name of the controller
    @param {Object} model the model to infer the type of the controller (optional)
  */
  generateController: function(name, model) {
    var container = this.container;

    model = model || this.modelFor(name);

    return Ember.generateController(container, name, model);
  },

  /**
    Returns the model of a parent (or any ancestor) route
    in a route hierarchy.  During a transition, all routes
    must resolve a model object, and if a route
    needs access to a parent route's model in order to
    resolve a model (or just reuse the model from a parent),
    it can call `this.modelFor(theNameOfParentRoute)` to
    retrieve it.

    Example

    ```js
    App.Router.map(function() {
        this.resource('post', { path: '/post/:post_id' }, function() {
            this.resource('comments');
        });
    });

    App.CommentsRoute = Ember.Route.extend({
        afterModel: function() {
            this.set('post', this.modelFor('post'));
        }
    });
    ```

    @method modelFor
    @param {String} name the name of the route
    @return {Object} the model object
  */
  modelFor: function(name) {

    var route = this.container.lookup('route:' + name),
        transition = this.router.router.activeTransition;

    // If we are mid-transition, we want to try and look up
    // resolved parent contexts on the current transitionEvent.
    if (transition) {
      var modelLookupName = (route && route.routeName) || name;
      if (transition.resolvedModels.hasOwnProperty(modelLookupName)) {
        return transition.resolvedModels[modelLookupName];
      }
    }

    return route && route.currentModel;
  },

  /**
    A hook you can use to render the template for the current route.

    This method is called with the controller for the current route and the
    model supplied by the `model` hook. By default, it renders the route's
    template, configured with the controller for the route.

    This method can be overridden to set up and render additional or
    alternative templates.

    ```js
    App.PostsRoute = Ember.Route.extend({
      renderTemplate: function(controller, model) {
        var favController = this.controllerFor('favoritePost');

        // Render the `favoritePost` template into
        // the outlet `posts`, and display the `favoritePost`
        // controller.
        this.render('favoritePost', {
          outlet: 'posts',
          controller: favController
        });
      }
    });
    ```

    @method renderTemplate
    @param {Object} controller the route's controller
    @param {Object} model the route's model
  */
  renderTemplate: function(controller, model) {
    this.render();
  },

  /**
    Renders a template into an outlet.

    This method has a number of defaults, based on the name of the
    route specified in the router.

    For example:

    ```js
    App.Router.map(function() {
      this.route('index');
      this.resource('post', {path: '/posts/:post_id'});
    });

    App.PostRoute = App.Route.extend({
      renderTemplate: function() {
        this.render();
      }
    });
    ```

    The name of the `PostRoute`, as defined by the router, is `post`.

    By default, render will:

    * render the `post` template
    * with the `post` view (`PostView`) for event handling, if one exists
    * and the `post` controller (`PostController`), if one exists
    * into the `main` outlet of the `application` template

    You can override this behavior:

    ```js
    App.PostRoute = App.Route.extend({
      renderTemplate: function() {
        this.render('myPost', {   // the template to render
          into: 'index',          // the template to render into
          outlet: 'detail',       // the name of the outlet in that template
          controller: 'blogPost'  // the controller to use for the template
        });
      }
    });
    ```

    Remember that the controller's `content` will be the route's model. In
    this case, the default model will be `App.Post.find(params.post_id)`.

    @method render
    @param {String} name the name of the template to render
    @param {Object} options the options
  */
  render: function(name, options) {
    Ember.assert("The name in the given arguments is undefined", arguments.length > 0 ? !Ember.isNone(arguments[0]) : true);

    var namePassed = !!name;

    if (typeof name === 'object' && !options) {
      options = name;
      name = this.routeName;
    }

    options = options || {};

    var templateName;

    if (name) {
      name = name.replace(/\//g, '.');
      templateName = name;
    } else {
      name = this.routeName;
      templateName = this.templateName || name;
    }

    var viewName = options.view || this.viewName || name;

    var container = this.container,
        view = container.lookup('view:' + viewName),
        template = view ? view.get('template') : null;

    if (!template) {
      template = container.lookup('template:' + templateName);
    }

    if (!view && !template) {
      Ember.assert("Could not find \"" + name + "\" template or view.", !namePassed);
      if (get(this.router, 'namespace.LOG_VIEW_LOOKUPS')) {
        Ember.Logger.info("Could not find \"" + name + "\" template or view. Nothing will be rendered", { fullName: 'template:' + name });
      }
      return;
    }

    options = normalizeOptions(this, name, template, options);
    view = setupView(view, container, options);

    if (options.outlet === 'main') { this.lastRenderedTemplate = name; }

    appendView(this, view, options);
  },

  /**
    Disconnects a view that has been rendered into an outlet.

    You may pass any or all of the following options to `disconnectOutlet`:

    * `outlet`: the name of the outlet to clear (default: 'main')
    * `parentView`: the name of the view containing the outlet to clear
       (default: the view rendered by the parent route)

    Example:

    ```js
    App.ApplicationRoute = App.Route.extend({
      actions: {
        showModal: function(evt) {
          this.render(evt.modalName, {
            outlet: 'modal',
            into: 'application'
          });
        },
        hideModal: function(evt) {
          this.disconnectOutlet({
            outlet: 'modal',
            parentView: 'application'
          });
        }
      }
    });
    ```

    Alternatively, you can pass the `outlet` name directly as a string.

    Example:

    ```js
    hideModal: function(evt) {
      this.disconnectOutlet('modal');
    }
    ```

    @method disconnectOutlet
    @param {Object|String} options the options hash or outlet name
  */
  disconnectOutlet: function(options) {
    if (!options || typeof options === "string") {
      var outletName = options;
      options = {};
      options.outlet = outletName;
    }
    options.parentView = options.parentView ? options.parentView.replace(/\//g, '.') : parentTemplate(this);
    options.outlet = options.outlet || 'main';

    var parentView = this.router._lookupActiveView(options.parentView);
    if (parentView) { parentView.disconnectOutlet(options.outlet); }
  },

  willDestroy: function() {
    this.teardownViews();
  },

  /**
    @private

    @method teardownViews
  */
  teardownViews: function() {
    // Tear down the top level view
    if (this.teardownTopLevelView) { this.teardownTopLevelView(); }

    // Tear down any outlets rendered with 'into'
    var teardownOutletViews = this.teardownOutletViews || [];
    a_forEach(teardownOutletViews, function(teardownOutletView) {
      teardownOutletView();
    });

    delete this.teardownTopLevelView;
    delete this.teardownOutletViews;
    delete this.lastRenderedTemplate;
  }
});


if (Ember.FEATURES.isEnabled("query-params-new")) {
  Ember.Route.reopen({
    paramsFor: function(name) {
      var route = this.container.lookup('route:' + name);

      if (!route) {
        return {};
      }

      var transition = this.router.router.activeTransition;
      var queryParamsHash = this.router._queryParamNamesForSingle(route.routeName);

      var params, queryParams;
      if (transition) {
        params = transition.params[name] || {};
        queryParams = transition.queryParams;
      } else {
        var state = this.router.router.state;
        params = state.params[name] || {};
        queryParams = state.queryParams;
      }

      this.router._queryParamOverrides(params, queryParamsHash.queryParams, function(name, resultsName, colonized) {
        // Replace the controller-supplied value with more up
        // to date values (e.g. from an incoming transition).
        var value = (resultsName in queryParams) ?
                    queryParams[resultsName]  :  params[resultsName];
        delete params[resultsName];
        params[colonized.split(':').pop()] = value;
      });

      return params;
    }
  });
}

function parentRoute(route) {
  var handlerInfos = route.router.router.state.handlerInfos;

  if (!handlerInfos) { return; }

  var parent, current;

  for (var i=0, l=handlerInfos.length; i<l; i++) {
    current = handlerInfos[i].handler;
    if (current === route) { return parent; }
    parent = current;
  }
}

function parentTemplate(route) {
  var parent = parentRoute(route), template;

  if (!parent) { return; }

  if (template = parent.lastRenderedTemplate) {
    return template;
  } else {
    return parentTemplate(parent);
  }
}

function normalizeOptions(route, name, template, options) {
  options = options || {};
  options.into = options.into ? options.into.replace(/\//g, '.') : parentTemplate(route);
  options.outlet = options.outlet || 'main';
  options.name = name;
  options.template = template;
  options.LOG_VIEW_LOOKUPS = get(route.router, 'namespace.LOG_VIEW_LOOKUPS');

  Ember.assert("An outlet ("+options.outlet+") was specified but was not found.", options.outlet === 'main' || options.into);

  var controller = options.controller, namedController;

  if (options.controller) {
    controller = options.controller;
  } else if (namedController = route.container.lookup('controller:' + name)) {
    controller = namedController;
  } else {
    controller = route.controllerName || route.routeName;
  }

  if (typeof controller === 'string') {
    var controllerName = controller;
    controller = route.container.lookup('controller:' + controllerName);
    if (!controller) {
      throw new Ember.Error("You passed `controller: '" + controllerName + "'` into the `render` method, but no such controller could be found.");
    }
  }

  options.controller = controller;

  return options;
}

function setupView(view, container, options) {
  if (view) {
    if (options.LOG_VIEW_LOOKUPS) {
      Ember.Logger.info("Rendering " + options.name + " with " + view, { fullName: 'view:' + options.name });
    }
  } else {
    var defaultView = options.into ? 'view:default' : 'view:toplevel';
    view = container.lookup(defaultView);
    if (options.LOG_VIEW_LOOKUPS) {
      Ember.Logger.info("Rendering " + options.name + " with default view " + view, { fullName: 'view:' + options.name });
    }
  }

  if (!get(view, 'templateName')) {
    set(view, 'template', options.template);

    set(view, '_debugTemplateName', options.name);
  }

  set(view, 'renderedName', options.name);
  set(view, 'controller', options.controller);

  return view;
}

function appendView(route, view, options) {
  if (options.into) {
    var parentView = route.router._lookupActiveView(options.into);
    var teardownOutletView = generateOutletTeardown(parentView, options.outlet);
    if (!route.teardownOutletViews) { route.teardownOutletViews = []; }
    a_replace(route.teardownOutletViews, 0, 0, [teardownOutletView]);
    parentView.connectOutlet(options.outlet, view);
  } else {
    var rootElement = get(route, 'router.namespace.rootElement');
    // tear down view if one is already rendered
    if (route.teardownTopLevelView) {
      route.teardownTopLevelView();
    }
    route.router._connectActiveView(options.name, view);
    route.teardownTopLevelView = generateTopLevelTeardown(view);
    view.appendTo(rootElement);
  }
}

function generateTopLevelTeardown(view) {
  return function() { view.destroy(); };
}

function generateOutletTeardown(parentView, outlet) {
  return function() { parentView.disconnectOutlet(outlet); };
}

})();



(function() {

})();



(function() {
Ember.onLoad('Ember.Handlebars', function() {
  var handlebarsResolve = Ember.Handlebars.resolveParams,
      map = Ember.ArrayPolyfills.map,
      get = Ember.get,
      handlebarsGet = Ember.Handlebars.get;

  function resolveParams(context, params, options) {
    return map.call(resolvePaths(context, params, options), function(path, i) {
      if (null === path) {
        // Param was string/number, not a path, so just return raw string/number.
        return params[i];
      } else {
        return handlebarsGet(context, path, options);
      }
    });
  }

  function resolvePaths(context, params, options) {
    var resolved = handlebarsResolve(context, params, options),
        types = options.types;

    return map.call(resolved, function(object, i) {
      if (types[i] === 'ID') {
        return unwrap(object, params[i]);
      } else {
        return null;
      }
    });

    function unwrap(object, path) {
      if (path === 'controller') { return path; }

      if (Ember.ControllerMixin.detect(object)) {
        return unwrap(get(object, 'model'), path ? path + '.model' : 'model');
      } else {
        return path;
      }
    }
  }

  Ember.Router.resolveParams = resolveParams;
  Ember.Router.resolvePaths = resolvePaths;
});

})();



(function() {
/**
@module ember
@submodule ember-routing
*/

var get = Ember.get, set = Ember.set, fmt = Ember.String.fmt;

var slice = Array.prototype.slice;
var numberOfContextsAcceptedByHandler = function(handler, handlerInfos) {
  var req = 0;
  for (var i = 0, l = handlerInfos.length; i < l; i++) {
    req = req + handlerInfos[i].names.length;
    if (handlerInfos[i].handler === handler)
      break;
  }

  // query params adds an additional context
  if (Ember.FEATURES.isEnabled("query-params-new")) {
    req = req + 1;
  }
  return req;
};

Ember.onLoad('Ember.Handlebars', function(Handlebars) {

  var QueryParams = Ember.Object.extend({
    values: null
  });

  var resolveParams = Ember.Router.resolveParams,
      translateQueryParams = Ember.Router._translateQueryParams,
      resolvePaths  = Ember.Router.resolvePaths,
      isSimpleClick = Ember.ViewUtils.isSimpleClick;

  function getResolvedPaths(options) {

    var types = options.options.types,
        data = options.options.data;

    return resolvePaths(options.context, options.params, { types: types, data: data });
  }

  /**
    `Ember.LinkView` renders an element whose `click` event triggers a
    transition of the application's instance of `Ember.Router` to
    a supplied route by name.

    Instances of `LinkView` will most likely be created through
    the `link-to` Handlebars helper, but properties of this class
    can be overridden to customize application-wide behavior.

    @class LinkView
    @namespace Ember
    @extends Ember.View
    @see {Handlebars.helpers.link-to}
  **/
  var LinkView = Ember.LinkView = Ember.View.extend({
    tagName: 'a',
    currentWhen: null,

    /**
      Sets the `title` attribute of the `LinkView`'s HTML element.

      @property title
      @default null
    **/
    title: null,

    /**
      Sets the `rel` attribute of the `LinkView`'s HTML element.

      @property rel
      @default null
    **/
    rel: null,

    /**
      The CSS class to apply to `LinkView`'s element when its `active`
      property is `true`.

      @property activeClass
      @type String
      @default active
    **/
    activeClass: 'active',

    /**
      The CSS class to apply to `LinkView`'s element when its `loading`
      property is `true`.

      @property loadingClass
      @type String
      @default loading
    **/
    loadingClass: 'loading',

    /**
      The CSS class to apply to a `LinkView`'s element when its `disabled`
      property is `true`.

      @property disabledClass
      @type String
      @default disabled
    **/
    disabledClass: 'disabled',
    _isDisabled: false,

    /**
      Determines whether the `LinkView` will trigger routing via
      the `replaceWith` routing strategy.

      @property replace
      @type Boolean
      @default false
    **/
    replace: false,

    /**
      By default the `{{link-to}}` helper will bind to the `href` and
      `title` attributes. It's discourage that you override these defaults,
      however you can push onto the array if needed.

      @property attributeBindings
      @type Array | String
      @default ['href', 'title', 'rel']
     **/
    attributeBindings: ['href', 'title', 'rel'],

    /**
      By default the `{{link-to}}` helper will bind to the `active`, `loading`, and
      `disabled` classes. It is discouraged to override these directly.

      @property classNameBindings
      @type Array
      @default ['active', 'loading', 'disabled']
     **/
    classNameBindings: ['active', 'loading', 'disabled'],

    /**
      By default the `{{link-to}}` helper responds to the `click` event. You
      can override this globally by setting this property to your custom
      event name.

      This is particularly useful on mobile when one wants to avoid the 300ms
      click delay using some sort of custom `tap` event.

      @property eventName
      @type String
      @default click
    */
    eventName: 'click',

    // this is doc'ed here so it shows up in the events
    // section of the API documentation, which is where
    // people will likely go looking for it.
    /**
      Triggers the `LinkView`'s routing behavior. If
      `eventName` is changed to a value other than `click`
      the routing behavior will trigger on that custom event
      instead.

      @event click
    **/

    /**
      An overridable method called when LinkView objects are instantiated.

      Example:

      ```javascript
      App.MyLinkView = Ember.LinkView.extend({
        init: function() {
          this._super();
          Ember.Logger.log('Event is ' + this.get('eventName'));
        }
      });
      ```

      NOTE: If you do override `init` for a framework class like `Ember.View` or
      `Ember.ArrayController`, be sure to call `this._super()` in your
      `init` declaration! If you don't, Ember may not have an opportunity to
      do important setup work, and you'll see strange behavior in your
      application.

      @method init
    */
    init: function() {
      this._super.apply(this, arguments);

      // Map desired event name to invoke function
      var eventName = get(this, 'eventName'), i;
      this.on(eventName, this, this._invoke);
    },

    /**
      This method is invoked by observers installed during `init` that fire
      whenever the params change

      @private
      @method _paramsChanged
     */
    _paramsChanged: function() {
      this.notifyPropertyChange('resolvedParams');
    },

    /**
     This is called to setup observers that will trigger a rerender.

     @private
     @method _setupPathObservers
    **/
    _setupPathObservers: function(){
      var helperParameters = this.parameters,
          linkTextPath     = helperParameters.options.linkTextPath,
          paths = getResolvedPaths(helperParameters),
          length = paths.length,
          path, i, normalizedPath;

      if (linkTextPath) {
        normalizedPath = Ember.Handlebars.normalizePath(helperParameters.context, linkTextPath, helperParameters.options.data);
        this.registerObserver(normalizedPath.root, normalizedPath.path, this, this.rerender);
      }

      for(i=0; i < length; i++) {
        path = paths[i];
        if (null === path) {
          // A literal value was provided, not a path, so nothing to observe.
          continue;
        }

        normalizedPath = Ember.Handlebars.normalizePath(helperParameters.context, path, helperParameters.options.data);
        this.registerObserver(normalizedPath.root, normalizedPath.path, this, this._paramsChanged);
      }

      var queryParamsObject = this.queryParamsObject;
      if (queryParamsObject) {
        var values = queryParamsObject.values;

        // Install observers for all of the hash options
        // provided in the (query-params) subexpression.
        for (var k in values) {
          if (!values.hasOwnProperty(k)) { continue; }

          if (queryParamsObject.types[k] === 'ID') {
            normalizedPath = Ember.Handlebars.normalizePath(helperParameters.context, values[k], helperParameters.options.data);
            this.registerObserver(normalizedPath.root, normalizedPath.path, this, this._paramsChanged);
          }
        }
      }
    },

    afterRender: function(){
      this._super.apply(this, arguments);
      this._setupPathObservers();
    },

    /**
      Even though this isn't a virtual view, we want to treat it as if it is
      so that you can access the parent with {{view.prop}}

      @private
      @method concreteView
    **/
    concreteView: Ember.computed(function() {
      return get(this, 'parentView');
    }).property('parentView'),

    /**

      Accessed as a classname binding to apply the `LinkView`'s `disabledClass`
      CSS `class` to the element when the link is disabled.

      When `true` interactions with the element will not trigger route changes.
      @property disabled
    */
    disabled: Ember.computed(function computeLinkViewDisabled(key, value) {
      if (value !== undefined) { this.set('_isDisabled', value); }

      return value ? get(this, 'disabledClass') : false;
    }),

    /**
      Accessed as a classname binding to apply the `LinkView`'s `activeClass`
      CSS `class` to the element when the link is active.

      A `LinkView` is considered active when its `currentWhen` property is `true`
      or the application's current route is the route the `LinkView` would trigger
      transitions into.

      @property active
    **/
    active: Ember.computed(function computeLinkViewActive() {
      if (get(this, 'loading')) { return false; }

      var router = get(this, 'router'),
          routeArgs = get(this, 'routeArgs'),
          contexts = routeArgs.slice(1),
          resolvedParams = get(this, 'resolvedParams'),
          currentWhen = this.currentWhen || routeArgs[0],
          maximumContexts = numberOfContextsAcceptedByHandler(currentWhen, router.router.recognizer.handlersFor(currentWhen));

      // if we don't have enough contexts revert back to full route name
      // this is because the leaf route will use one of the contexts
      if (contexts.length > maximumContexts)
        currentWhen = routeArgs[0];
      
      var isActive = router.isActive.apply(router, [currentWhen].concat(contexts));

      if (isActive) { return get(this, 'activeClass'); }
    }).property('resolvedParams', 'routeArgs'),

    /**
      Accessed as a classname binding to apply the `LinkView`'s `loadingClass`
      CSS `class` to the element when the link is loading.

      A `LinkView` is considered loading when it has at least one
      parameter whose value is currently null or undefined. During
      this time, clicking the link will perform no transition and
      emit a warning that the link is still in a loading state.

      @property loading
    **/
    loading: Ember.computed(function computeLinkViewLoading() {
      if (!get(this, 'routeArgs')) { return get(this, 'loadingClass'); }
    }).property('routeArgs'),

    /**
      Returns the application's main router from the container.

      @private
      @property router
    **/
    router: Ember.computed(function() {
      return get(this, 'controller').container.lookup('router:main');
    }),

    /**
      Event handler that invokes the link, activating the associated route.

      @private
      @method _invoke
      @param {Event} event
    */
    _invoke: function(event) {
      if (!isSimpleClick(event)) { return true; }

      if (this.preventDefault !== false) { event.preventDefault(); }
      if (this.bubbles === false) { event.stopPropagation(); }

      if (get(this, '_isDisabled')) { return false; }

      if (get(this, 'loading')) {
        Ember.Logger.warn("This link-to is in an inactive loading state because at least one of its parameters presently has a null/undefined value, or the provided route name is invalid.");
        return false;
      }

      var router = get(this, 'router'),
          routeArgs = get(this, 'routeArgs');

      var transition;
      if (get(this, 'replace')) {
        transition = router.replaceWith.apply(router, routeArgs);
      } else {
        transition = router.transitionTo.apply(router, routeArgs);
      }

      // Schedule eager URL update, but after we've given the transition
      // a chance to synchronously redirect.
      if (Ember.FEATURES.isEnabled("ember-eager-url-update")) {
        // We need to always generate the URL instead of using the href because
        // the href will include any rootURL set, but the router expects a URL
        // without it! Note that we don't use the first level router because it
        // calls location.formatURL(), which also would add the rootURL!
        var url = router.router.generate.apply(router.router, get(this, 'routeArgs'));
        Ember.run.scheduleOnce('routerTransitions', this, this._eagerUpdateUrl, transition, url);
      }
    },

    /**
      @private
     */
    _eagerUpdateUrl: function(transition, href) {
      if (!transition.isActive || !transition.urlMethod) {
        // transition was aborted, already ran to completion,
        // or it has a null url-updated method.
        return;
      }

      if (href.indexOf('#') === 0) {
        href = href.slice(1);
      }

      // Re-use the routerjs hooks set up by the Ember router.
      var routerjs = get(this, 'router.router');
      if (transition.urlMethod === 'update') {
        routerjs.updateURL(href);
      } else if (transition.urlMethod === 'replace') {
        routerjs.replaceURL(href);
      }

      // Prevent later update url refire.
      transition.method(null);
    },

    /**
      Computed property that returns an array of the
      resolved parameters passed to the `link-to` helper,
      e.g.:

      ```hbs
      {{link-to a b '123' c}}
      ```

      will generate a `resolvedParams` of:

      ```js
      [aObject, bObject, '123', cObject]
      ```

      @private
      @property
      @return {Array}
     */
    resolvedParams: Ember.computed(function() {
      var parameters = this.parameters,
          options = parameters.options,
          types = options.types,
          data = options.data;

      if (parameters.params.length === 0) {
        var appController = this.container.lookup('controller:application');
        return [get(appController, 'currentRouteName')];
      } else {
        return resolveParams(parameters.context, parameters.params, { types: types, data: data });
      }
    }).property('router.url'),

    /**
      Computed property that returns the current route name and
      any dynamic segments.

      @private
      @property
      @return {Array} An array with the route name and any dynamic segments
     */
    routeArgs: Ember.computed(function computeLinkViewRouteArgs() {
      var resolvedParams = get(this, 'resolvedParams').slice(0),
          router = get(this, 'router'),
          namedRoute = resolvedParams[0];

      if (!namedRoute) { return; }

      Ember.assert(fmt("The attempt to link-to route '%@' failed. " +
                       "The router did not find '%@' in its possible routes: '%@'",
                       [namedRoute, namedRoute, Ember.keys(router.router.recognizer.names).join("', '")]),
                       router.hasRoute(namedRoute));

      //normalize route name
      var handlers = router.router.recognizer.handlersFor(namedRoute);
      var normalizedPath = handlers[handlers.length - 1].handler;
      if (namedRoute !== normalizedPath) {
        this.set('currentWhen', namedRoute);
        namedRoute = handlers[handlers.length - 1].handler;
        resolvedParams[0] = namedRoute;
      }

      for (var i = 1, len = resolvedParams.length; i < len; ++i) {
        var param = resolvedParams[i];
        if (param === null || typeof param === 'undefined') {
          // If contexts aren't present, consider the linkView unloaded.
          return;
        }
      }

      if (Ember.FEATURES.isEnabled("query-params-new")) {
        resolvedParams.push({ queryParams: get(this, 'queryParams') });
      }

      return resolvedParams;
    }).property('resolvedParams', 'queryParams'),

    queryParamsObject: null,
    queryParams: Ember.computed(function computeLinkViewQueryParams() {

      var queryParamsObject = get(this, 'queryParamsObject'),
          suppliedParams = {};

      if (queryParamsObject) {
        Ember.merge(suppliedParams, queryParamsObject.values);
      }

      var resolvedParams = get(this, 'resolvedParams'),
          router = get(this, 'router'),
          routeName = resolvedParams[0],
          paramsForRoute = router._queryParamNamesFor(routeName),
          queryParams = paramsForRoute.queryParams,
          translations = paramsForRoute.translations,
          paramsForRecognizer = {};

      // Normalize supplied params into their long-form name
      // e.g. 'foo' -> 'controllername:foo'
      translateQueryParams(suppliedParams, translations, routeName);

      var helperParameters = this.parameters;
      router._queryParamOverrides(paramsForRecognizer, queryParams, function(name, resultsName) {
        if (!(name in suppliedParams)) { return; }

        var parts = name.split(':');

        var type = queryParamsObject.types[parts[1]];

        var value;
        if (type === 'ID') {
          var normalizedPath = Ember.Handlebars.normalizePath(helperParameters.context, suppliedParams[name], helperParameters.options.data);
          value = Ember.Handlebars.get(normalizedPath.root, normalizedPath.path, helperParameters.options);
        } else {
          value = suppliedParams[name];
        }

        delete suppliedParams[name];

        paramsForRecognizer[resultsName] = value;
      });

      return paramsForRecognizer;
    }).property('resolvedParams.[]'),

    /**
      Sets the element's `href` attribute to the url for
      the `LinkView`'s targeted route.

      If the `LinkView`'s `tagName` is changed to a value other
      than `a`, this property will be ignored.

      @property href
    **/
    href: Ember.computed(function computeLinkViewHref() {
      if (get(this, 'tagName') !== 'a') { return; }

      var router = get(this, 'router'),
          routeArgs = get(this, 'routeArgs');

      return routeArgs ? router.generate.apply(router, routeArgs) : get(this, 'loadingHref');
    }).property('routeArgs'),

    /**
      The default href value to use while a link-to is loading.
      Only applies when tagName is 'a'

      @property loadingHref
      @type String
      @default #
    */
    loadingHref: '#'
  });

  LinkView.toString = function() { return "LinkView"; };

  /**
    The `{{link-to}}` helper renders a link to the supplied
    `routeName` passing an optionally supplied model to the
    route as its `model` context of the route. The block
    for `{{link-to}}` becomes the innerHTML of the rendered
    element:

    ```handlebars
    {{#link-to 'photoGallery'}}
      Great Hamster Photos
    {{/link-to}}
    ```

    ```html
    <a href="/hamster-photos">
      Great Hamster Photos
    </a>
    ```

    ### Supplying a tagName
    By default `{{link-to}}` renders an `<a>` element. This can
    be overridden for a single use of `{{link-to}}` by supplying
    a `tagName` option:

    ```handlebars
    {{#link-to 'photoGallery' tagName="li"}}
      Great Hamster Photos
    {{/link-to}}
    ```

    ```html
    <li>
      Great Hamster Photos
    </li>
    ```

    To override this option for your entire application, see
    "Overriding Application-wide Defaults".

    ### Disabling the `link-to` helper
    By default `{{link-to}}` is enabled.
    any passed value to `disabled` helper property will disable the `link-to` helper.

    static use: the `disabled` option:

    ```handlebars
    {{#link-to 'photoGallery' disabled=true}}
      Great Hamster Photos
    {{/link-to}}
    ```

    dynamic use: the `disabledWhen` option:

    ```handlebars
    {{#link-to 'photoGallery' disabledWhen=controller.someProperty}}
      Great Hamster Photos
    {{/link-to}}
    ```

    any passed value to `disabled` will disable it except `undefined`.
    to ensure that only `true` disable the `link-to` helper you can
    override the global behaviour of `Ember.LinkView`.

    ```javascript
    Ember.LinkView.reopen({
      disabled: Ember.computed(function(key, value) {
        if (value !== undefined) {
          this.set('_isDisabled', value === true);
        }
        return value === true ? get(this, 'disabledClass') : false;
      })
    });
    ```

    see "Overriding Application-wide Defaults" for more.

    ### Handling `href`
    `{{link-to}}` will use your application's Router to
    fill the element's `href` property with a url that
    matches the path to the supplied `routeName` for your
    routers's configured `Location` scheme, which defaults
    to Ember.HashLocation.

    ### Handling current route
    `{{link-to}}` will apply a CSS class name of 'active'
    when the application's current route matches
    the supplied routeName. For example, if the application's
    current route is 'photoGallery.recent' the following
    use of `{{link-to}}`:

    ```handlebars
    {{#link-to 'photoGallery.recent'}}
      Great Hamster Photos from the last week
    {{/link-to}}
    ```

    will result in

    ```html
    <a href="/hamster-photos/this-week" class="active">
      Great Hamster Photos
    </a>
    ```

    The CSS class name used for active classes can be customized
    for a single use of `{{link-to}}` by passing an `activeClass`
    option:

    ```handlebars
    {{#link-to 'photoGallery.recent' activeClass="current-url"}}
      Great Hamster Photos from the last week
    {{/link-to}}
    ```

    ```html
    <a href="/hamster-photos/this-week" class="current-url">
      Great Hamster Photos
    </a>
    ```

    To override this option for your entire application, see
    "Overriding Application-wide Defaults".

    ### Supplying a model
    An optional model argument can be used for routes whose
    paths contain dynamic segments. This argument will become
    the model context of the linked route:

    ```javascript
    App.Router.map(function() {
      this.resource("photoGallery", {path: "hamster-photos/:photo_id"});
    });
    ```

    ```handlebars
    {{#link-to 'photoGallery' aPhoto}}
      {{aPhoto.title}}
    {{/link-to}}
    ```

    ```html
    <a href="/hamster-photos/42">
      Tomster
    </a>
    ```

    ### Supplying multiple models
    For deep-linking to route paths that contain multiple
    dynamic segments, multiple model arguments can be used.
    As the router transitions through the route path, each
    supplied model argument will become the context for the
    route with the dynamic segments:

    ```javascript
    App.Router.map(function() {
      this.resource("photoGallery", {path: "hamster-photos/:photo_id"}, function() {
        this.route("comment", {path: "comments/:comment_id"});
      });
    });
    ```
    This argument will become the model context of the linked route:

    ```handlebars
    {{#link-to 'photoGallery.comment' aPhoto comment}}
      {{comment.body}}
    {{/link-to}}
    ```

    ```html
    <a href="/hamster-photos/42/comment/718">
      A+++ would snuggle again.
    </a>
    ```

    ### Supplying an explicit dynamic segment value
    If you don't have a model object available to pass to `{{link-to}}`,
    an optional string or integer argument can be passed for routes whose
    paths contain dynamic segments. This argument will become the value
    of the dynamic segment:

    ```javascript
    App.Router.map(function() {
      this.resource("photoGallery", {path: "hamster-photos/:photo_id"});
    });
    ```

    ```handlebars
    {{#link-to 'photoGallery' aPhotoId}}
      {{aPhoto.title}}
    {{/link-to}}
    ```

    ```html
    <a href="/hamster-photos/42">
      Tomster
    </a>
    ```

    When transitioning into the linked route, the `model` hook will
    be triggered with parameters including this passed identifier.

    ### Allowing Default Action

   By default the `{{link-to}}` helper prevents the default browser action
   by calling `preventDefault()` as this sort of action bubbling is normally
   handled internally and we do not want to take the browser to a new URL (for
   example).

   If you need to override this behavior specify `preventDefault=false` in
   your template:

    ```handlebars
    {{#link-to 'photoGallery' aPhotoId preventDefault=false}}
      {{aPhotoId.title}}
    {{/link-to}}
    ```

    ### Overriding attributes
    You can override any given property of the Ember.LinkView
    that is generated by the `{{link-to}}` helper by passing
    key/value pairs, like so:

    ```handlebars
    {{#link-to  aPhoto tagName='li' title='Following this link will change your life' classNames='pic sweet'}}
      Uh-mazing!
    {{/link-to}}
    ```

    See [Ember.LinkView](/api/classes/Ember.LinkView.html) for a
    complete list of overrideable properties. Be sure to also
    check out inherited properties of `LinkView`.

    ### Overriding Application-wide Defaults
    ``{{link-to}}`` creates an instance of Ember.LinkView
    for rendering. To override options for your entire
    application, reopen Ember.LinkView and supply the
    desired values:

    ``` javascript
    Ember.LinkView.reopen({
      activeClass: "is-active",
      tagName: 'li'
    })
    ```

    It is also possible to override the default event in
    this manner:

    ``` javascript
    Ember.LinkView.reopen({
      eventName: 'customEventName'
    });
    ```

    @method link-to
    @for Ember.Handlebars.helpers
    @param {String} routeName
    @param {Object} [context]*
    @param [options] {Object} Handlebars key/value pairs of options, you can override any property of Ember.LinkView
    @return {String} HTML string
    @see {Ember.LinkView}
  */
  Ember.Handlebars.registerHelper('link-to', function linkToHelper(name) {
    var options = slice.call(arguments, -1)[0],
        params = slice.call(arguments, 0, -1),
        hash = options.hash;

    if (params[params.length - 1] instanceof QueryParams) {
      hash.queryParamsObject = params.pop();
    }

    hash.disabledBinding = hash.disabledWhen;

    if (!options.fn) {
      var linkTitle = params.shift();
      var linkType = options.types.shift();
      var context = this;
      if (linkType === 'ID') {
        options.linkTextPath = linkTitle;
        options.fn = function() {
          return Ember.Handlebars.getEscaped(context, linkTitle, options);
        };
      } else {
        options.fn = function() {
          return linkTitle;
        };
      }
    }

    hash.parameters = {
      context: this,
      options: options,
      params: params
    };

    return Ember.Handlebars.helpers.view.call(this, LinkView, options);
  });


  if (Ember.FEATURES.isEnabled("query-params-new")) {
    Ember.Handlebars.registerHelper('query-params', function queryParamsHelper(options) {
      Ember.assert(fmt("The `query-params` helper only accepts hash parameters, e.g. (query-params queryParamPropertyName='%@') as opposed to just (query-params '%@')", [options, options]), arguments.length === 1);

      return QueryParams.create({
        values: options.hash,
        types: options.hashTypes
      });
    });
  }

  /**
    See [link-to](/api/classes/Ember.Handlebars.helpers.html#method_link-to)

    @method linkTo
    @for Ember.Handlebars.helpers
    @deprecated
    @param {String} routeName
    @param {Object} [context]*
    @return {String} HTML string
  */
  Ember.Handlebars.registerHelper('linkTo', function linkToHelper() {
    Ember.warn("The 'linkTo' view helper is deprecated in favor of 'link-to'");
    return Ember.Handlebars.helpers['link-to'].apply(this, arguments);
  });
});



})();



(function() {
/**
@module ember
@submodule ember-routing
*/

var get = Ember.get, set = Ember.set;
Ember.onLoad('Ember.Handlebars', function(Handlebars) {
  /**
  @module ember
  @submodule ember-routing
  */

  Handlebars.OutletView = Ember.ContainerView.extend(Ember._Metamorph);

  /**
    The `outlet` helper is a placeholder that the router will fill in with
    the appropriate template based on the current state of the application.

    ``` handlebars
    {{outlet}}
    ```

    By default, a template based on Ember's naming conventions will be rendered
    into the `outlet` (e.g. `App.PostsRoute` will render the `posts` template).

    You can render a different template by using the `render()` method in the
    route's `renderTemplate` hook. The following will render the `favoritePost`
    template into the `outlet`.

    ``` javascript
    App.PostsRoute = Ember.Route.extend({
      renderTemplate: function() {
        this.render('favoritePost');
      }
    });
    ```

    You can create custom named outlets for more control.

    ``` handlebars
    {{outlet 'favoritePost'}}
    {{outlet 'posts'}}
    ```

    Then you can define what template is rendered into each outlet in your
    route.


    ``` javascript
    App.PostsRoute = Ember.Route.extend({
      renderTemplate: function() {
        this.render('favoritePost', { outlet: 'favoritePost' });
        this.render('posts', { outlet: 'posts' });
      }
    });
    ```

    You can specify the view that the outlet uses to contain and manage the
    templates rendered into it.

    ``` handlebars
    {{outlet view='sectionContainer'}}
    ```

    ``` javascript
    App.SectionContainer = Ember.ContainerView.extend({
      tagName: 'section',
      classNames: ['special']
    });
    ```

    @method outlet
    @for Ember.Handlebars.helpers
    @param {String} property the property on the controller
      that holds the view for this outlet
    @return {String} HTML string
  */
  Handlebars.registerHelper('outlet', function outletHelper(property, options) {
   
    var outletSource,
        container,
        viewName,
        viewClass,
        viewFullName;

    if (property && property.data && property.data.isRenderData) {
      options = property;
      property = 'main';
    }

    container = options.data.view.container;

    outletSource = options.data.view;
    while (!outletSource.get('template.isTop')) {
      outletSource = outletSource.get('_parentView');
    }

    // provide controller override
    viewName = options.hash.view;

    if (viewName) {
      viewFullName = 'view:' + viewName;
      Ember.assert("Using a quoteless view parameter with {{outlet}} is not supported. Please update to quoted usage '{{outlet \"" + viewName + "\"}}.", options.hashTypes.view !== 'ID');
      Ember.assert("The view name you supplied '" + viewName + "' did not resolve to a view.", container.has(viewFullName));
    }

    viewClass = viewName ? container.lookupFactory(viewFullName) : options.hash.viewClass || Handlebars.OutletView;

    options.data.view.set('outletSource', outletSource);
    options.hash.currentViewBinding = '_view.outletSource._outlets.' + property;

    return Handlebars.helpers.view.call(this, viewClass, options);
  });
});

})();



(function() {
/**
@module ember
@submodule ember-routing
*/

var get = Ember.get, set = Ember.set;
Ember.onLoad('Ember.Handlebars', function(Handlebars) {

  /**
    Calling ``{{render}}`` from within a template will insert another
    template that matches the provided name. The inserted template will
    access its properties on its own controller (rather than the controller
    of the parent template).

    If a view class with the same name exists, the view class also will be used.

    Note: A given controller may only be used *once* in your app in this manner.
    A singleton instance of the controller will be created for you.

    Example:

    ```javascript
    App.NavigationController = Ember.Controller.extend({
      who: "world"
    });
    ```

    ```handlebars
    <!-- navigation.hbs -->
    Hello, {{who}}.
    ```

    ```handelbars
    <!-- application.hbs -->
    <h1>My great app</h1>
    {{render "navigation"}}
    ```

    ```html
    <h1>My great app</h1>
    <div class='ember-view'>
      Hello, world.
    </div>
    ```

    Optionally you may provide a second argument: a property path
    that will be bound to the `model` property of the controller.

    If a `model` property path is specified, then a new instance of the
    controller will be created and `{{render}}` can be used multiple times
    with the same name.

   For example if you had this `author` template.

   ```handlebars
<div class="author">
  Written by {{firstName}} {{lastName}}.
  Total Posts: {{postCount}}
</div>
  ```

  You could render it inside the `post` template using the `render` helper.

  ```handlebars
<div class="post">
  <h1>{{title}}</h1>
  <div>{{body}}</div>
  {{render "author" author}}
</div>
   ```

    @method render
    @for Ember.Handlebars.helpers
    @param {String} name
    @param {Object?} contextString
    @param {Hash} options
    @return {String} HTML string
  */
  Ember.Handlebars.registerHelper('render', function renderHelper(name, contextString, options) {
    var length = arguments.length;

    var contextProvided = length === 3,
        container, router, controller, view, context, lookupOptions;

    container = (options || contextString).data.keywords.controller.container;
    router = container.lookup('router:main');

    if (length === 2) {
      // use the singleton controller
      options = contextString;
      contextString = undefined;
      Ember.assert("You can only use the {{render}} helper once without a model object as its second argument, as in {{render \"post\" post}}.", !router || !router._lookupActiveView(name));
    } else if (length === 3) {
      // create a new controller
      context = Ember.Handlebars.get(options.contexts[1], contextString, options);
    } else {
      throw Ember.Error("You must pass a templateName to render");
    }

    Ember.deprecate("Using a quoteless parameter with {{render}} is deprecated. Please update to quoted usage '{{render \"" + name + "\"}}.", options.types[0] !== 'ID');

    // # legacy namespace
    name = name.replace(/\//g, '.');
    // \ legacy slash as namespace support


    view = container.lookup('view:' + name) || container.lookup('view:default');

    // provide controller override
    var controllerName = options.hash.controller || name;
    var controllerFullName = 'controller:' + controllerName;

    if (options.hash.controller) {
      Ember.assert("The controller name you supplied '" + controllerName + "' did not resolve to a controller.", container.has(controllerFullName));
    }

    var parentController = options.data.keywords.controller;

    // choose name
    if (length > 2) {
      var factory = container.lookupFactory(controllerFullName) ||
                    Ember.generateControllerFactory(container, controllerName, context);

      controller = factory.create({
        model: context,
        parentController: parentController,
        target: parentController
      });

    } else {
      controller = container.lookup(controllerFullName) ||
                   Ember.generateController(container, controllerName);

      controller.setProperties({
        target: parentController,
        parentController: parentController
      });
    }

    var root = options.contexts[1];

    if (root) {
      view.registerObserver(root, contextString, function() {
        controller.set('model', Ember.Handlebars.get(root, contextString, options));
      });
    }

    options.hash.viewName = Ember.String.camelize(name);

    var templateName = 'template:' + name;
    Ember.assert("You used `{{render '" + name + "'}}`, but '" + name + "' can not be found as either a template or a view.", container.has("view:" + name) || container.has(templateName) || options.fn);
    options.hash.template = container.lookup(templateName);

    options.hash.controller = controller;

    if (router && !context) {
      router._connectActiveView(name, view);
    }

    Ember.Handlebars.helpers.view.call(this, view, options);
  });
});

})();



(function() {
/**
@module ember
@submodule ember-routing
*/
Ember.onLoad('Ember.Handlebars', function(Handlebars) {

  var resolveParams = Ember.Router.resolveParams,
      isSimpleClick = Ember.ViewUtils.isSimpleClick;

  var EmberHandlebars = Ember.Handlebars,
      handlebarsGet = EmberHandlebars.get,
      SafeString = EmberHandlebars.SafeString,
      forEach = Ember.ArrayPolyfills.forEach,
      get = Ember.get,
      a_slice = Array.prototype.slice;

  function args(options, actionName) {
    var ret = [];
    if (actionName) { ret.push(actionName); }

    var types = options.options.types.slice(1),
        data = options.options.data;

    return ret.concat(resolveParams(options.context, options.params, { types: types, data: data }));
  }

  var ActionHelper = EmberHandlebars.ActionHelper = {
    registeredActions: {}
  };

  var keys = ["alt", "shift", "meta", "ctrl"];

  var POINTER_EVENT_TYPE_REGEX = /^click|mouse|touch/;

  var isAllowedEvent = function(event, allowedKeys) {
    if (typeof allowedKeys === "undefined") {
      if (POINTER_EVENT_TYPE_REGEX.test(event.type)) {
        return isSimpleClick(event);
      } else {
        allowedKeys = '';
      }
    }

    if (allowedKeys.indexOf("any") >= 0) {
      return true;
    }

    var allowed = true;

    forEach.call(keys, function(key) {
      if (event[key + "Key"] && allowedKeys.indexOf(key) === -1) {
        allowed = false;
      }
    });

    return allowed;
  };

  ActionHelper.registerAction = function(actionNameOrPath, options, allowedKeys) {
    var actionId = ++Ember.uuid;

    ActionHelper.registeredActions[actionId] = {
      eventName: options.eventName,
      handler: function handleRegisteredAction(event) {
        if (!isAllowedEvent(event, allowedKeys)) { return true; }

        if (options.preventDefault !== false) {
          event.preventDefault();
        }

        if (options.bubbles === false) {
          event.stopPropagation();
        }

        var target = options.target,
            actionName;

        if (target.target) {
          target = handlebarsGet(target.root, target.target, target.options);
        } else {
          target = target.root;
        }

        if (Ember.FEATURES.isEnabled("ember-routing-bound-action-name")) {
          if (options.boundProperty) {
            actionName = handlebarsGet(target, actionNameOrPath, options.options);

            if(typeof actionName === 'undefined' || typeof actionName === 'function') {
              Ember.assert("You specified a quoteless path to the {{action}} helper '" + actionNameOrPath + "' which did not resolve to an actionName. Perhaps you meant to use a quoted actionName? (e.g. {{action '" + actionNameOrPath + "'}}).", true);
              actionName = actionNameOrPath;
            }
          }
        } else {
          if (options.boundProperty) {
            Ember.deprecate("Using a quoteless parameter with {{action}} is deprecated. Please update to quoted usage '{{action \"" + actionNameOrPath + "\"}}.", false);
          }
        }

        if (!actionName) {
          actionName = actionNameOrPath;
        }

        Ember.run(function runRegisteredAction() {
          if (target.send) {
            target.send.apply(target, args(options.parameters, actionName));
          } else {
            Ember.assert("The action '" + actionName + "' did not exist on " + target, typeof target[actionName] === 'function');
            target[actionName].apply(target, args(options.parameters));
          }
        });
      }
    };

    options.view.on('willClearRender', function() {
      delete ActionHelper.registeredActions[actionId];
    });

    return actionId;
  };

  /**
    The `{{action}}` helper registers an HTML element within a template for DOM
    event handling and forwards that interaction to the templates's controller
    or supplied `target` option (see 'Specifying a Target').

    If the controller does not implement the event, the event is sent
    to the current route, and it bubbles up the route hierarchy from there.

    User interaction with that element will invoke the supplied action name on
    the appropriate target. Specifying a non-quoted action name will result in
    a bound property lookup at the time the event will be triggered.

    Given the following application Handlebars template on the page

    ```handlebars
    <div {{action 'anActionName'}}>
      click me
    </div>
    ```

    And application code

    ```javascript
    App.ApplicationController = Ember.Controller.extend({
      actions: {
        anActionName: function() {
        }
      }
    });
    ```

    Will result in the following rendered HTML

    ```html
    <div class="ember-view">
      <div data-ember-action="1">
        click me
      </div>
    </div>
    ```

    Clicking "click me" will trigger the `anActionName` action of the
    `App.ApplicationController`. In this case, no additional parameters will be passed.

    If you provide additional parameters to the helper:

    ```handlebars
    <button {{action 'edit' post}}>Edit</button>
    ```

    Those parameters will be passed along as arguments to the JavaScript
    function implementing the action.

    ### Event Propagation

    Events triggered through the action helper will automatically have
    `.preventDefault()` called on them. You do not need to do so in your event
    handlers. If you need to allow event propagation (to handle file inputs for
    example) you can supply the `preventDefault=false` option to the `{{action}}` helper:

    ```handlebars
    <div {{action "sayHello" preventDefault=false}}>
      <input type="file" />
      <input type="checkbox" />
    </div>
    ```

    To disable bubbling, pass `bubbles=false` to the helper:

    ```handlebars
    <button {{action 'edit' post bubbles=false}}>Edit</button>
    ```

    If you need the default handler to trigger you should either register your
    own event handler, or use event methods on your view class. See [Ember.View](/api/classes/Ember.View.html)
    'Responding to Browser Events' for more information.

    ### Specifying DOM event type

    By default the `{{action}}` helper registers for DOM `click` events. You can
    supply an `on` option to the helper to specify a different DOM event name:

    ```handlebars
    <div {{action "anActionName" on="doubleClick"}}>
      click me
    </div>
    ```

    See `Ember.View` 'Responding to Browser Events' for a list of
    acceptable DOM event names.

    NOTE: Because `{{action}}` depends on Ember's event dispatch system it will
    only function if an `Ember.EventDispatcher` instance is available. An
    `Ember.EventDispatcher` instance will be created when a new `Ember.Application`
    is created. Having an instance of `Ember.Application` will satisfy this
    requirement.

    ### Specifying whitelisted modifier keys

    By default the `{{action}}` helper will ignore click event with pressed modifier
    keys. You can supply an `allowedKeys` option to specify which keys should not be ignored.

    ```handlebars
    <div {{action "anActionName" allowedKeys="alt"}}>
      click me
    </div>
    ```

    This way the `{{action}}` will fire when clicking with the alt key pressed down.

    Alternatively, supply "any" to the `allowedKeys` option to accept any combination of modifier keys.

    ```handlebars
    <div {{action "anActionName" allowedKeys="any"}}>
      click me with any key pressed
    </div>
    ```

    ### Specifying a Target

    There are several possible target objects for `{{action}}` helpers:

    In a typical Ember application, where views are managed through use of the
    `{{outlet}}` helper, actions will bubble to the current controller, then
    to the current route, and then up the route hierarchy.

    Alternatively, a `target` option can be provided to the helper to change
    which object will receive the method call. This option must be a path
    to an object, accessible in the current context:

    ```handlebars
    {{! the application template }}
    <div {{action "anActionName" target=view}}>
      click me
    </div>
    ```

    ```javascript
    App.ApplicationView = Ember.View.extend({
      actions: {
        anActionName: function(){}
      }
    });

    ```

    ### Additional Parameters

    You may specify additional parameters to the `{{action}}` helper. These
    parameters are passed along as the arguments to the JavaScript function
    implementing the action.

    ```handlebars
    {{#each person in people}}
      <div {{action "edit" person}}>
        click me
      </div>
    {{/each}}
    ```

    Clicking "click me" will trigger the `edit` method on the current controller
    with the value of `person` as a parameter.

    @method action
    @for Ember.Handlebars.helpers
    @param {String} actionName
    @param {Object} [context]*
    @param {Hash} options
  */
  EmberHandlebars.registerHelper('action', function actionHelper(actionName) {
    var options = arguments[arguments.length - 1],
        contexts = a_slice.call(arguments, 1, -1);

    var hash = options.hash,
        controller = options.data.keywords.controller;

    // create a hash to pass along to registerAction
    var action = {
      eventName: hash.on || "click",
      parameters: {
        context: this,
        options: options,
        params: contexts
      },
      view: options.data.view,
      bubbles: hash.bubbles,
      preventDefault: hash.preventDefault,
      target: { options: options },
      boundProperty: options.types[0] === "ID"
    };

    if (hash.target) {
      action.target.root = this;
      action.target.target = hash.target;
    } else if (controller) {
      action.target.root = controller;
    }

    var actionId = ActionHelper.registerAction(actionName, action, hash.allowedKeys);
    return new SafeString('data-ember-action="' + actionId + '"');
  });
});

})();



(function() {

})();



(function() {
/**
@module ember
@submodule ember-routing
*/

var get = Ember.get, set = Ember.set,
    map = Ember.EnumerableUtils.map;

var queuedQueryParamChanges = {};

Ember.ControllerMixin.reopen({
  /**
    Transition the application into another route. The route may
    be either a single route or route path:

    ```javascript
    aController.transitionToRoute('blogPosts');
    aController.transitionToRoute('blogPosts.recentEntries');
    ```

    Optionally supply a model for the route in question. The model
    will be serialized into the URL using the `serialize` hook of
    the route:

    ```javascript
    aController.transitionToRoute('blogPost', aPost);
    ```

    If a literal is passed (such as a number or a string), it will
    be treated as an identifier instead. In this case, the `model`
    hook of the route will be triggered:

    ```javascript
    aController.transitionToRoute('blogPost', 1);
    ```

    Multiple models will be applied last to first recursively up the
    resource tree.

    ```javascript
    App.Router.map(function() {
      this.resource('blogPost', {path:':blogPostId'}, function(){
        this.resource('blogComment', {path: ':blogCommentId'});
      });
    });
    
    aController.transitionToRoute('blogComment', aPost, aComment);
    aController.transitionToRoute('blogComment', 1, 13);
    ```

    It is also possible to pass a URL (a string that starts with a
    `/`). This is intended for testing and debugging purposes and
    should rarely be used in production code.

    ```javascript
    aController.transitionToRoute('/');
    aController.transitionToRoute('/blog/post/1/comment/13');
    ```

    See also [replaceRoute](/api/classes/Ember.ControllerMixin.html#method_replaceRoute).

    @param {String} name the name of the route or a URL
    @param {...Object} models the model(s) or identifier(s) to be used
    while transitioning to the route.
    @for Ember.ControllerMixin
    @method transitionToRoute
  */
  transitionToRoute: function() {
    // target may be either another controller or a router
    var target = get(this, 'target'),
        method = target.transitionToRoute || target.transitionTo;
    return method.apply(target, arguments);
  },

  /**
    @deprecated
    @for Ember.ControllerMixin
    @method transitionTo
  */
  transitionTo: function() {
    Ember.deprecate("transitionTo is deprecated. Please use transitionToRoute.");
    return this.transitionToRoute.apply(this, arguments);
  },

  /**
    Transition into another route while replacing the current URL, if possible.
    This will replace the current history entry instead of adding a new one.
    Beside that, it is identical to `transitionToRoute` in all other respects.

    ```javascript
    aController.replaceRoute('blogPosts');
    aController.replaceRoute('blogPosts.recentEntries');
    ```

    Optionally supply a model for the route in question. The model
    will be serialized into the URL using the `serialize` hook of
    the route:

    ```javascript
    aController.replaceRoute('blogPost', aPost);
    ```

    If a literal is passed (such as a number or a string), it will
    be treated as an identifier instead. In this case, the `model`
    hook of the route will be triggered:

    ```javascript
    aController.replaceRoute('blogPost', 1);
    ```

    Multiple models will be applied last to first recursively up the
    resource tree.

    ```javascript
    App.Router.map(function() {
      this.resource('blogPost', {path:':blogPostId'}, function(){
        this.resource('blogComment', {path: ':blogCommentId'});
      });
    });
    
    aController.replaceRoute('blogComment', aPost, aComment);
    aController.replaceRoute('blogComment', 1, 13);
    ```

    It is also possible to pass a URL (a string that starts with a
    `/`). This is intended for testing and debugging purposes and
    should rarely be used in production code.

    ```javascript
    aController.replaceRoute('/');
    aController.replaceRoute('/blog/post/1/comment/13');
    ```

    @param {String} name the name of the route or a URL
    @param {...Object} models the model(s) or identifier(s) to be used
    while transitioning to the route.
    @for Ember.ControllerMixin
    @method replaceRoute
  */
  replaceRoute: function() {
    // target may be either another controller or a router
    var target = get(this, 'target'),
        method = target.replaceRoute || target.replaceWith;
    return method.apply(target, arguments);
  },

  /**
    @deprecated
    @for Ember.ControllerMixin
    @method replaceWith
  */
  replaceWith: function() {
    Ember.deprecate("replaceWith is deprecated. Please use replaceRoute.");
    return this.replaceRoute.apply(this, arguments);
  }
});

if (Ember.FEATURES.isEnabled("query-params-new")) {
  Ember.ControllerMixin.reopen({

    concatenatedProperties: ['queryParams'],

    queryParams: null,

    _queryParamScope: null,

    _finalizingQueryParams: false,
    _queryParamHash: Ember.computed(function computeQueryParamHash() {

      // Given: queryParams: ['foo', 'bar:baz'] on controller:thing
      // _queryParamHash should yield: { 'foo': 'thing[foo]' }

      var result = {};
      var queryParams = this.queryParams;
      if (!queryParams) {
        return result;
      }

      for (var i = 0, len = queryParams.length; i < len; ++i) {
        var full = queryParams[i];
        var parts = full.split(':');
        var key = parts[0];
        var urlKey = parts[1];
        if (!urlKey) {
          if (this._queryParamScope) {
            urlKey = this._queryParamScope + '[' + key + ']';
          } else {
            urlKey = key;
          }
        }
        result[key] = urlKey;
      }

      return result;
    }),

    _activateQueryParamObservers: function() {
      var queryParams = get(this, '_queryParamHash');

      for (var k in queryParams) {
        if (queryParams.hasOwnProperty(k)) {
          this.addObserver(k, this, this._queryParamChanged);
          this.addObserver(k + '.[]', this, this._queryParamChanged);
        }
      }
    },

    _deactivateQueryParamObservers: function() {
      var queryParams = get(this, '_queryParamHash');

      for (var k in queryParams) {
        if (queryParams.hasOwnProperty(k)) {
          this.removeObserver(k, this, this._queryParamChanged);
          this.removeObserver(k + '.[]', this, this._queryParamChanged);
        }
      }
    },

    _queryParamChanged: function(controller, key) {
      // Normalize array observer firings.
      if (key.slice(key.length - 3) === '.[]') {
        key = key.substr(0, key.length-3);
      }

      if (this._finalizingQueryParams) {
        var changes = this._queryParamChangesDuringSuspension;
        if (changes) {
          changes[key] = true;
        }
        return;
      }

      var queryParams = get(this, '_queryParamHash');
      queuedQueryParamChanges[queryParams[key]] = Ember.copy(get(this, key));
      Ember.run.once(this, this._fireQueryParamTransition);
    },

    _fireQueryParamTransition: function() {
      this.transitionToRoute({ queryParams: queuedQueryParamChanges });
      queuedQueryParamChanges = {};
    },

    _queryParamChangesDuringSuspension: null
  });
}

})();



(function() {
/**
@module ember
@submodule ember-routing
*/

var get = Ember.get, set = Ember.set;

Ember.View.reopen({

  /**
    Sets the private `_outlets` object on the view.

    @method init
   */
  init: function() {
    set(this, '_outlets', {});
    this._super();
  },

  /**
    Manually fill any of a view's `{{outlet}}` areas with the
    supplied view.

    Example

    ```javascript
    var MyView = Ember.View.extend({
      template: Ember.Handlebars.compile('Child view: {{outlet "main"}} ')
    });
    var myView = MyView.create();
    myView.appendTo('body');
    // The html for myView now looks like:
    // <div id="ember228" class="ember-view">Child view: </div>

    var FooView = Ember.View.extend({
      template: Ember.Handlebars.compile('<h1>Foo</h1> ')
    });
    var fooView = FooView.create();
    myView.connectOutlet('main', fooView);
    // The html for myView now looks like:
    // <div id="ember228" class="ember-view">Child view:
    //   <div id="ember234" class="ember-view"><h1>Foo</h1> </div>
    // </div>
    ```
    @method connectOutlet
    @param  {String} outletName A unique name for the outlet
    @param  {Object} view       An Ember.View
   */
  connectOutlet: function(outletName, view) {
    if (this._pendingDisconnections) {
      delete this._pendingDisconnections[outletName];
    }

    if (this._hasEquivalentView(outletName, view)) {
      view.destroy();
      return;
    }

    var outlets = get(this, '_outlets'),
        container = get(this, 'container'),
        router = container && container.lookup('router:main'),
        renderedName = get(view, 'renderedName');

    set(outlets, outletName, view);

    if (router && renderedName) {
      router._connectActiveView(renderedName, view);
    }
  },

  /**
    Determines if the view has already been created by checking if
    the view has the same constructor, template, and context as the
    view in the `_outlets` object.

    @private
    @method _hasEquivalentView
    @param  {String} outletName The name of the outlet we are checking
    @param  {Object} view       An Ember.View
    @return {Boolean}
   */
  _hasEquivalentView: function(outletName, view) {
    var existingView = get(this, '_outlets.'+outletName);
    return existingView &&
      existingView.constructor === view.constructor &&
      existingView.get('template') === view.get('template') &&
      existingView.get('context') === view.get('context');
  },

  /**
    Removes an outlet from the view.

    Example

    ```javascript
    var MyView = Ember.View.extend({
      template: Ember.Handlebars.compile('Child view: {{outlet "main"}} ')
    });
    var myView = MyView.create();
    myView.appendTo('body');
    // myView's html:
    // <div id="ember228" class="ember-view">Child view: </div>

    var FooView = Ember.View.extend({
      template: Ember.Handlebars.compile('<h1>Foo</h1> ')
    });
    var fooView = FooView.create();
    myView.connectOutlet('main', fooView);
    // myView's html:
    // <div id="ember228" class="ember-view">Child view:
    //   <div id="ember234" class="ember-view"><h1>Foo</h1> </div>
    // </div>

    myView.disconnectOutlet('main');
    // myView's html:
    // <div id="ember228" class="ember-view">Child view: </div>
    ```

    @method disconnectOutlet
    @param  {String} outletName The name of the outlet to be removed
   */
  disconnectOutlet: function(outletName) {
    if (!this._pendingDisconnections) {
      this._pendingDisconnections = {};
    }
    this._pendingDisconnections[outletName] = true;
    Ember.run.once(this, '_finishDisconnections');
  },

  /**
    Gets an outlet that is pending disconnection and then
    nullifys the object on the `_outlet` object.

    @private
    @method _finishDisconnections
   */
  _finishDisconnections: function() {
    if (this.isDestroyed) return; // _outlets will be gone anyway
    var outlets = get(this, '_outlets');
    var pendingDisconnections = this._pendingDisconnections;
    this._pendingDisconnections = null;

    for (var outletName in pendingDisconnections) {
      set(outlets, outletName, null);
    }
  }
});

})();



(function() {
/**
@module ember
@submodule ember-views
*/

// Add a new named queue after the 'actions' queue (where RSVP promises
// resolve), which is used in router transitions to prevent unnecessary
// loading state entry if all context promises resolve on the 
// 'actions' queue first.

var queues = Ember.run.queues,
    indexOf = Ember.ArrayPolyfills.indexOf;
queues.splice(indexOf.call(queues, 'actions') + 1, 0, 'routerTransitions');

})();



(function() {
/**
@module ember
@submodule ember-routing
*/

var get = Ember.get, set = Ember.set;

/**
  Ember.Location returns an instance of the correct implementation of
  the `location` API.

  ## Implementations

  You can pass an implementation name (`hash`, `history`, `none`) to force a
  particular implementation to be used in your application.

  ### HashLocation

  Using `HashLocation` results in URLs with a `#` (hash sign) separating the
  server side URL portion of the URL from the portion that is used by Ember.
  This relies upon the `hashchange` event existing in the browser.

  Example:

  ```javascript
  App.Router.map(function() {
    this.resource('posts', function() {
      this.route('new');
    });
  });

  App.Router.reopen({
    location: 'hash'
  });
  ```

  This will result in a posts.new url of `/#/posts/new`.

  ### HistoryLocation

  Using `HistoryLocation` results in URLs that are indistinguishable from a
  standard URL. This relies upon the browser's `history` API.

  Example:

  ```javascript
  App.Router.map(function() {
    this.resource('posts', function() {
      this.route('new');
    });
  });

  App.Router.reopen({
    location: 'history'
  });
  ```

  This will result in a posts.new url of `/posts/new`.

  Keep in mind that your server must serve the Ember app at all the routes you
  define.

  ### AutoLocation

  Using `AutoLocation`, the router will use the best Location class supported by
  the browser it is running in.

  Browsers that support the `history` API will use `HistoryLocation`, those that
  do not, but still support the `hashchange` event will use `HashLocation`, and
  in the rare case neither is supported will use `NoneLocation`.

  Example:

  ```javascript
  App.Router.map(function() {
    this.resource('posts', function() {
      this.route('new');
    });
  });

  App.Router.reopen({
    location: 'auto'
  });
  ```

  This will result in a posts.new url of `/posts/new` for modern browsers that
  support the `history` api or `/#/posts/new` for older ones, like Internet
  Explorer 9 and below.

  When a user visits a link to your application, they will be automatically
  upgraded or downgraded to the appropriate `Location` class, with the URL
  transformed accordingly, if needed.

  Keep in mind that since some of your users will use `HistoryLocation`, your
  server must serve the Ember app at all the routes you define.

  ### NoneLocation

  Using `NoneLocation` causes Ember to not store the applications URL state
  in the actual URL. This is generally used for testing purposes, and is one
  of the changes made when calling `App.setupForTesting()`.

  ## Location API

  Each location implementation must provide the following methods:

  * implementation: returns the string name used to reference the implementation.
  * getURL: returns the current URL.
  * setURL(path): sets the current URL.
  * replaceURL(path): replace the current URL (optional).
  * onUpdateURL(callback): triggers the callback when the URL changes.
  * formatURL(url): formats `url` to be placed into `href` attribute.

  Calling setURL or replaceURL will not trigger onUpdateURL callbacks.

  @class Location
  @namespace Ember
  @static
*/
Ember.Location = {
  /**
   This is deprecated in favor of using the container to lookup the location
   implementation as desired.

   For example:

   ```javascript
   // Given a location registered as follows:
   container.register('location:history-test', HistoryTestLocation);

   // You could create a new instance via:
   container.lookup('location:history-test');
   ```

    @method create
    @param {Object} options
    @return {Object} an instance of an implementation of the `location` API
    @deprecated Use the container to lookup the location implementation that you
    need.
  */
  create: function(options) {
    var implementation = options && options.implementation;
    Ember.assert("Ember.Location.create: you must specify a 'implementation' option", !!implementation);

    var implementationClass = this.implementations[implementation];
    Ember.assert("Ember.Location.create: " + implementation + " is not a valid implementation", !!implementationClass);

    return implementationClass.create.apply(implementationClass, arguments);
  },

  /**
   This is deprecated in favor of using the container to register the
   location implementation as desired.

   Example:

   ```javascript
   Application.initializer({
    name: "history-test-location",

    initialize: function(container, application) {
      application.register('location:history-test', HistoryTestLocation);
    }
   });
   ```

   @method registerImplementation
   @param {String} name
   @param {Object} implementation of the `location` API
   @deprecated Register your custom location implementation with the
   container directly.
  */
  registerImplementation: function(name, implementation) {
    Ember.deprecate('Using the Ember.Location.registerImplementation is no longer supported. Register your custom location implementation with the container instead.', false);

    this.implementations[name] = implementation;
  },

  implementations: {},
  _location: window.location,

  /**
    Returns the current `location.hash` by parsing location.href since browsers
    inconsistently URL-decode `location.hash`.
  
    https://bugzilla.mozilla.org/show_bug.cgi?id=483304

    @private
    @method getHash
  */
  _getHash: function () {
    // AutoLocation has it at _location, HashLocation at .location.
    // Being nice and not changing 
    var href = (this._location || this.location).href,
        hashIndex = href.indexOf('#');

    if (hashIndex === -1) {
      return '';
    } else {
      return href.substr(hashIndex);
    }
  }
};

})();



(function() {
/**
@module ember
@submodule ember-routing
*/

var get = Ember.get, set = Ember.set;

/**
  Ember.NoneLocation does not interact with the browser. It is useful for
  testing, or when you need to manage state with your Router, but temporarily
  don't want it to muck with the URL (for example when you embed your
  application in a larger page).

  @class NoneLocation
  @namespace Ember
  @extends Ember.Object
*/
Ember.NoneLocation = Ember.Object.extend({
  implementation: 'none',
  path: '',

  /**
    Returns the current path.

    @private
    @method getURL
    @return {String} path
  */
  getURL: function() {
    return get(this, 'path');
  },

  /**
    Set the path and remembers what was set. Using this method
    to change the path will not invoke the `updateURL` callback.

    @private
    @method setURL
    @param path {String}
  */
  setURL: function(path) {
    set(this, 'path', path);
  },

  /**
    Register a callback to be invoked when the path changes. These
    callbacks will execute when the user presses the back or forward
    button, but not after `setURL` is invoked.

    @private
    @method onUpdateURL
    @param callback {Function}
  */
  onUpdateURL: function(callback) {
    this.updateCallback = callback;
  },

  /**
    Sets the path and calls the `updateURL` callback.

    @private
    @method handleURL
    @param callback {Function}
  */
  handleURL: function(url) {
    set(this, 'path', url);
    this.updateCallback(url);
  },

  /**
    Given a URL, formats it to be placed into the page as part
    of an element's `href` attribute.

    This is used, for example, when using the {{action}} helper
    to generate a URL based on an event.

    @private
    @method formatURL
    @param url {String}
    @return {String} url
  */
  formatURL: function(url) {
    // The return value is not overly meaningful, but we do not want to throw
    // errors when test code renders templates containing {{action href=true}}
    // helpers.
    return url;
  }
});

})();



(function() {
/**
@module ember
@submodule ember-routing
*/

var get = Ember.get, set = Ember.set;

/**
  `Ember.HashLocation` implements the location API using the browser's
  hash. At present, it relies on a `hashchange` event existing in the
  browser.

  @class HashLocation
  @namespace Ember
  @extends Ember.Object
*/
Ember.HashLocation = Ember.Object.extend({
  implementation: 'hash',

  init: function() {
    set(this, 'location', get(this, '_location') || window.location);
  },

  /**
    @private

    Returns normalized location.hash

    @method getHash
  */
  getHash: Ember.Location._getHash,

  /**
    Returns the current `location.hash`, minus the '#' at the front.

    @private
    @method getURL
  */
  getURL: function() {
    return this.getHash().substr(1);
  },

  /**
    Set the `location.hash` and remembers what was set. This prevents
    `onUpdateURL` callbacks from triggering when the hash was set by
    `HashLocation`.

    @private
    @method setURL
    @param path {String}
  */
  setURL: function(path) {
    get(this, 'location').hash = path;
    set(this, 'lastSetURL', path);
  },

  /**
    Uses location.replace to update the url without a page reload
    or history modification.

    @private
    @method replaceURL
    @param path {String}
  */
  replaceURL: function(path) {
    get(this, 'location').replace('#' + path);
    set(this, 'lastSetURL', path);
  },

  /**
    Register a callback to be invoked when the hash changes. These
    callbacks will execute when the user presses the back or forward
    button, but not after `setURL` is invoked.

    @private
    @method onUpdateURL
    @param callback {Function}
  */
  onUpdateURL: function(callback) {
    var self = this;
    var guid = Ember.guidFor(this);

    Ember.$(window).on('hashchange.ember-location-'+guid, function() {
      Ember.run(function() {
        var path = self.getURL();
        if (get(self, 'lastSetURL') === path) { return; }

        set(self, 'lastSetURL', null);

        callback(path);
      });
    });
  },

  /**
    Given a URL, formats it to be placed into the page as part
    of an element's `href` attribute.

    This is used, for example, when using the {{action}} helper
    to generate a URL based on an event.

    @private
    @method formatURL
    @param url {String}
  */
  formatURL: function(url) {
    return '#'+url;
  },

  /**
    Cleans up the HashLocation event listener.

    @private
    @method willDestroy
  */
  willDestroy: function() {
    var guid = Ember.guidFor(this);

    Ember.$(window).off('hashchange.ember-location-'+guid);
  }
});

})();



(function() {
/**
@module ember
@submodule ember-routing
*/

var get = Ember.get, set = Ember.set;
var popstateFired = false;
var supportsHistoryState = window.history && 'state' in window.history;

/**
  Ember.HistoryLocation implements the location API using the browser's
  history.pushState API.

  @class HistoryLocation
  @namespace Ember
  @extends Ember.Object
*/
Ember.HistoryLocation = Ember.Object.extend({
  implementation: 'history',

  init: function() {
    set(this, 'location', get(this, 'location') || window.location);
    set(this, 'baseURL', Ember.$('base').attr('href') || '');
  },

  /**
    Used to set state on first call to setURL

    @private
    @method initState
  */
  initState: function() {
    set(this, 'history', get(this, 'history') || window.history);
    this.replaceState(this.formatURL(this.getURL()));
  },

  /**
    Will be pre-pended to path upon state change

    @property rootURL
    @default '/'
  */
  rootURL: '/',

  /**
    Returns the current `location.pathname` without `rootURL` or `baseURL`

    @private
    @method getURL
    @return url {String}
  */
  getURL: function() {
    var rootURL = get(this, 'rootURL'),
        location = get(this, 'location'),
        path = location.pathname,
        baseURL = get(this, 'baseURL');

    rootURL = rootURL.replace(/\/$/, '');
    baseURL = baseURL.replace(/\/$/, '');
    var url = path.replace(baseURL, '').replace(rootURL, '');

    if (Ember.FEATURES.isEnabled("query-params-new")) {
      var search = location.search || '';
      url += search;
    }

    return url;
  },

  /**
    Uses `history.pushState` to update the url without a page reload.

    @private
    @method setURL
    @param path {String}
  */
  setURL: function(path) {
    var state = this.getState();
    path = this.formatURL(path);

    if (!state || state.path !== path) {
      this.pushState(path);
    }
  },

  /**
    Uses `history.replaceState` to update the url without a page reload
    or history modification.

    @private
    @method replaceURL
    @param path {String}
  */
  replaceURL: function(path) {
    var state = this.getState();
    path = this.formatURL(path);

    if (!state || state.path !== path) {
      this.replaceState(path);
    }
  },

  /**
   Get the current `history.state`. Checks for if a polyfill is
   required and if so fetches this._historyState. The state returned
   from getState may be null if an iframe has changed a window's
   history.

   @private
   @method getState
   @return state {Object}
  */
  getState: function() {
    return supportsHistoryState ? get(this, 'history').state : this._historyState;
  },

  /**
   Pushes a new state.

   @private
   @method pushState
   @param path {String}
  */
  pushState: function(path) {
    var state = { path: path };

    get(this, 'history').pushState(state, null, path);

    // store state if browser doesn't support `history.state`
    if (!supportsHistoryState) {
      this._historyState = state;
    }

    // used for webkit workaround
    this._previousURL = this.getURL();
  },

  /**
   Replaces the current state.

   @private
   @method replaceState
   @param path {String}
  */
  replaceState: function(path) {
    var state = { path: path };

    get(this, 'history').replaceState(state, null, path);

    // store state if browser doesn't support `history.state`
    if (!supportsHistoryState) {
      this._historyState = state;
    }

    // used for webkit workaround
    this._previousURL = this.getURL();
  },

  /**
    Register a callback to be invoked whenever the browser
    history changes, including using forward and back buttons.

    @private
    @method onUpdateURL
    @param callback {Function}
  */
  onUpdateURL: function(callback) {
    var guid = Ember.guidFor(this),
        self = this;

    Ember.$(window).on('popstate.ember-location-'+guid, function(e) {
      // Ignore initial page load popstate event in Chrome
      if (!popstateFired) {
        popstateFired = true;
        if (self.getURL() === self._previousURL) { return; }
      }
      callback(self.getURL());
    });
  },

  /**
    Used when using `{{action}}` helper.  The url is always appended to the rootURL.

    @private
    @method formatURL
    @param url {String}
    @return formatted url {String}
  */
  formatURL: function(url) {
    var rootURL = get(this, 'rootURL'),
        baseURL = get(this, 'baseURL');

    if (url !== '') {
      rootURL = rootURL.replace(/\/$/, '');
      baseURL = baseURL.replace(/\/$/, '');
    } else if(baseURL.match(/^\//) && rootURL.match(/^\//)) {
      baseURL = baseURL.replace(/\/$/, '');
    }

    return baseURL + rootURL + url;
  },

  /**
    Cleans up the HistoryLocation event listener.

    @private
    @method willDestroy
  */
  willDestroy: function() {
    var guid = Ember.guidFor(this);

    Ember.$(window).off('popstate.ember-location-'+guid);
  }
});

})();



(function() {
if (Ember.FEATURES.isEnabled("ember-routing-auto-location")) {
  /**
  @module ember
  @submodule ember-routing
  */

  var get = Ember.get, set = Ember.set,
      HistoryLocation = Ember.HistoryLocation,
      HashLocation = Ember.HashLocation,
      NoneLocation = Ember.NoneLocation,
      EmberLocation = Ember.Location;

  /**
    Ember.AutoLocation will select the best location option based off browser
    support with the priority order: history, hash, none.

    Clean pushState paths accessed by hashchange-only browsers will be redirected
    to the hash-equivalent and vice versa so future transitions are consistent.

    Keep in mind that since some of your users will use `HistoryLocation`, your
    server must serve the Ember app at all the routes you define.

    @class AutoLocation
    @namespace Ember
    @static
  */
  var AutoLocation = Ember.AutoLocation = {

    /**
      @private

      This property is used by router:main to know whether to cancel the routing
      setup process, which is needed while we redirect the browser.

      @property cancelRouterSetup
      @default false
    */
    cancelRouterSetup: false,

    /**
      @private

      Will be pre-pended to path upon state change.

      @property rootURL
      @default '/'
    */
    rootURL: '/',

    /**
      @private

      Attached for mocking in tests

      @property _window
      @default window
    */
    _window: window,

    /**
      @private

      Attached for mocking in tests

      @property location
      @default window.location
    */
    _location: window.location,

    /**
      @private

      Attached for mocking in tests

      @property _history
      @default window.history
    */
    _history: window.history,

    /**
      @private

      Attached for mocking in tests

      @property _HistoryLocation
      @default Ember.HistoryLocation
    */
    _HistoryLocation: HistoryLocation,

    /**
      @private

      Attached for mocking in tests

      @property _HashLocation
      @default Ember.HashLocation
    */
    _HashLocation: HashLocation,

    /**
      @private

      Attached for mocking in tests

      @property _NoneLocation
      @default Ember.NoneLocation
    */
    _NoneLocation: NoneLocation,

    /**
      @private

      Returns location.origin or builds it if device doesn't support it.

      @method _getOrigin
    */
    _getOrigin: function () {
      var location = this._location,
          origin = location.origin;

      // Older browsers, especially IE, don't have origin
      if (!origin) {
        origin = location.protocol + '//' + location.hostname;

        if (location.port) {
          origin += ':' + location.port;
        }
      }

      return origin;
    },

    /**
      @private

      We assume that if the history object has a pushState method, the host should
      support HistoryLocation.

      @method _getSupportsHistory
    */
    _getSupportsHistory: function () {
      // Boosted from Modernizr: https://github.com/Modernizr/Modernizr/blob/master/feature-detects/history.js
      // The stock browser on Android 2.2 & 2.3 returns positive on history support
      // Unfortunately support is really buggy and there is no clean way to detect
      // these bugs, so we fall back to a user agent sniff :(
      var userAgent = this._window.navigator.userAgent;

      // We only want Android 2, stock browser, and not Chrome which identifies
      // itself as 'Mobile Safari' as well
      if (userAgent.indexOf('Android 2') !== -1 &&
          userAgent.indexOf('Mobile Safari') !== -1 &&
          userAgent.indexOf('Chrome') === -1) {
        return false;
      }

      return !!(this._history && 'pushState' in this._history);
    },

    /**
      @private

      IE8 running in IE7 compatibility mode gives false positive, so we must also
      check documentMode.

      @method _getSupportsHashChange
    */
    _getSupportsHashChange: function () {
      var window = this._window,
          documentMode = window.document.documentMode;

      return ('onhashchange' in window && (documentMode === undefined || documentMode > 7 ));
    },

    /**
      @private

      Redirects the browser using location.replace, prepending the locatin.origin
      to prevent phishing attempts

      @method _replacePath
    */
    _replacePath: function (path) {
      this._location.replace(this._getOrigin() + path);
    },

    /**
      @private
      @method _getRootURL
    */
    _getRootURL: function () {
      return this.rootURL;
    },

    /**
      @private

      Returns the current `location.pathname`, normalized for IE inconsistencies.

      @method _getPath
    */
    _getPath: function () {
      var pathname = this._location.pathname;
      // Various versions of IE/Opera don't always return a leading slash
      if (pathname.charAt(0) !== '/') {
        pathname = '/' + pathname;
      }

      return pathname;
    },

    /**
      @private

      Returns normalized location.hash as an alias to Ember.Location._getHash

      @method _getHash
    */
    _getHash: EmberLocation._getHash,

    /**
      @private

      Returns location.search

      @method _getQuery
    */
    _getQuery: function () {
      return this._location.search;
    },

    /**
      @private

      Returns the full pathname including query and hash

      @method _getFullPath
    */
    _getFullPath: function () {
      return this._getPath() + this._getQuery() + this._getHash();
    },

    /**
      @private

      Returns the current path as it should appear for HistoryLocation supported
      browsers. This may very well differ from the real current path (e.g. if it
      starts off as a hashed URL)

      @method _getHistoryPath
    */
    _getHistoryPath: function () {
      var rootURL = this._getRootURL(),
          path = this._getPath(),
          hash = this._getHash(),
          query = this._getQuery(),
          rootURLIndex = path.indexOf(rootURL),
          routeHash, hashParts;

      Ember.assert('Path ' + path + ' does not start with the provided rootURL ' + rootURL, rootURLIndex === 0);

      // By convention, Ember.js routes using HashLocation are required to start
      // with `#/`. Anything else should NOT be considered a route and should
      // be passed straight through, without transformation.
      if (hash.substr(0, 2) === '#/') {
        // There could be extra hash segments after the route
        hashParts = hash.substr(1).split('#');
        // The first one is always the route url
        routeHash = hashParts.shift();

        // If the path already has a trailing slash, remove the one
        // from the hashed route so we don't double up.
        if (path.slice(-1) === '/') {
            routeHash = routeHash.substr(1);
        }

        // This is the "expected" final order
        path += routeHash;
        path += query;

        if (hashParts.length) {
          path += '#' + hashParts.join('#');
        }
      } else {
        path += query;
        path += hash;
      }

      return path;
    },

    /**
      @private

      Returns the current path as it should appear for HashLocation supported
      browsers. This may very well differ from the real current path.

      @method _getHashPath
    */
    _getHashPath: function () {
      var rootURL = this._getRootURL(),
          path = rootURL,
          historyPath = this._getHistoryPath(),
          routePath = historyPath.substr(rootURL.length);

      if (routePath !== '') {
        if (routePath.charAt(0) !== '/') {
          routePath = '/' + routePath;
        }

        path += '#' + routePath;
      }

      return path;
    },

    /**
      Selects the best location option based off browser support and returns an
      instance of that Location class.

      @see Ember.AutoLocation
      @method create
    */
    create: function (options) {
      if (options && options.rootURL) {
        Ember.assert('rootURL must end with a trailing forward slash e.g. "/app/"', options.rootURL.charAt(options.rootURL.length-1) === '/');
        this.rootURL = options.rootURL;
      }

      var historyPath, hashPath,
          cancelRouterSetup = false,
          implementationClass = this._NoneLocation,
          currentPath = this._getFullPath();

      if (this._getSupportsHistory()) {
        historyPath = this._getHistoryPath();

        // Since we support history paths, let's be sure we're using them else
        // switch the location over to it.
        if (currentPath === historyPath) {
          implementationClass = this._HistoryLocation;
        } else {
          cancelRouterSetup = true;
          this._replacePath(historyPath);
        }

      } else if (this._getSupportsHashChange()) {
        hashPath = this._getHashPath();

        // Be sure we're using a hashed path, otherwise let's switch over it to so
        // we start off clean and consistent. We'll count an index path with no
        // hash as "good enough" as well.
        if (currentPath === hashPath || (currentPath === '/' && hashPath === '/#/')) {
          implementationClass = this._HashLocation;
        } else {
          // Our URL isn't in the expected hash-supported format, so we want to
          // cancel the router setup and replace the URL to start off clean
          cancelRouterSetup = true;
          this._replacePath(hashPath);
        }
      }

      var implementation = implementationClass.create.apply(implementationClass, arguments);

      if (cancelRouterSetup) {
        set(implementation, 'cancelRouterSetup', true);
      }

      return implementation;
    }
  };
}
})();



(function() {

})();



(function() {
/**
Ember Routing

@module ember
@submodule ember-routing
@requires ember-views
*/

})();

