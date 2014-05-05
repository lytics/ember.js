(function() {
/**
  @module ember
  @submodule ember-testing
 */
var slice = [].slice,
    helpers = {},
    injectHelpersCallbacks = [];

/**
  This is a container for an assortment of testing related functionality:

  * Choose your default test adapter (for your framework of choice).
  * Register/Unregister additional test helpers.
  * Setup callbacks to be fired when the test helpers are injected into
    your application.

  @class Test
  @namespace Ember
*/
Ember.Test = {

  /**
    `registerHelper` is used to register a test helper that will be injected
    when `App.injectTestHelpers` is called.

    The helper method will always be called with the current Application as
    the first parameter.

    For example:

    ```javascript
    Ember.Test.registerHelper('boot', function(app) {
      Ember.run(app, app.advanceReadiness);
    });
    ```

    This helper can later be called without arguments because it will be
    called with `app` as the first parameter.

    ```javascript
    App = Ember.Application.create();
    App.injectTestHelpers();
    boot();
    ```

    @public
    @method registerHelper
    @param {String} name The name of the helper method to add.
    @param {Function} helperMethod
    @param options {Object}
  */
  registerHelper: function(name, helperMethod) {
    helpers[name] = {
      method: helperMethod,
      meta: { wait: false }
    };
  },

  /**
    `registerAsyncHelper` is used to register an async test helper that will be injected
    when `App.injectTestHelpers` is called.

    The helper method will always be called with the current Application as
    the first parameter.

    For example:

    ```javascript
    Ember.Test.registerAsyncHelper('boot', function(app) {
      Ember.run(app, app.advanceReadiness);
    });
    ```

    The advantage of an async helper is that it will not run
    until the last async helper has completed.  All async helpers
    after it will wait for it complete before running.


    For example:

    ```javascript
    Ember.Test.registerAsyncHelper('deletePost', function(app, postId) {
      click('.delete-' + postId);
    });

    // ... in your test
    visit('/post/2');
    deletePost(2);
    visit('/post/3');
    deletePost(3);
    ```

    @public
    @method registerAsyncHelper
    @param {String} name The name of the helper method to add.
    @param {Function} helperMethod
  */
  registerAsyncHelper: function(name, helperMethod) {
    helpers[name] = {
      method: helperMethod,
      meta: { wait: true }
    };
  },

  /**
    Remove a previously added helper method.

    Example:

    ```javascript
    Ember.Test.unregisterHelper('wait');
    ```

    @public
    @method unregisterHelper
    @param {String} name The helper to remove.
  */
  unregisterHelper: function(name) {
    delete helpers[name];
    delete Ember.Test.Promise.prototype[name];
  },

  /**
    Used to register callbacks to be fired whenever `App.injectTestHelpers`
    is called.

    The callback will receive the current application as an argument.

    Example:

    ```javascript
    Ember.Test.onInjectHelpers(function() {
      Ember.$(document).ajaxSend(function() {
        Test.pendingAjaxRequests++;
      });

      Ember.$(document).ajaxComplete(function() {
        Test.pendingAjaxRequests--;
      });
    });
    ```

    @public
    @method onInjectHelpers
    @param {Function} callback The function to be called.
  */
  onInjectHelpers: function(callback) {
    injectHelpersCallbacks.push(callback);
  },

  /**
    This returns a thenable tailored for testing.  It catches failed
    `onSuccess` callbacks and invokes the `Ember.Test.adapter.exception`
    callback in the last chained then.

    This method should be returned by async helpers such as `wait`.

    @public
    @method promise
    @param {Function} resolver The function used to resolve the promise.
  */
  promise: function(resolver) {
    return new Ember.Test.Promise(resolver);
  },

  /**
   Used to allow ember-testing to communicate with a specific testing
   framework.

   You can manually set it before calling `App.setupForTesting()`.

   Example:

   ```javascript
   Ember.Test.adapter = MyCustomAdapter.create()
   ```

   If you do not set it, ember-testing will default to `Ember.Test.QUnitAdapter`.

   @public
   @property adapter
   @type {Class} The adapter to be used.
   @default Ember.Test.QUnitAdapter
  */
  adapter: null,

  /**
    Replacement for `Ember.RSVP.resolve`
    The only difference is this uses
    and instance of `Ember.Test.Promise`

    @public
    @method resolve
    @param {Mixed} The value to resolve
  */
  resolve: function(val) {
    return Ember.Test.promise(function(resolve) {
      return resolve(val);
    });
  },

  /**
     This allows ember-testing to play nicely with other asynchronous
     events, such as an application that is waiting for a CSS3
     transition or an IndexDB transaction.

     For example:

     ```javascript
     Ember.Test.registerWaiter(function() {
       return myPendingTransactions() == 0;
     });
     ```
     The `context` argument allows you to optionally specify the `this`
     with which your callback will be invoked.

     For example:

     ```javascript
     Ember.Test.registerWaiter(MyDB, MyDB.hasPendingTransactions);
     ```

     @public
     @method registerWaiter
     @param {Object} context (optional)
     @param {Function} callback
  */
  registerWaiter: function(context, callback) {
    if (arguments.length === 1) {
      callback = context;
      context = null;
    }
    if (!this.waiters) {
      this.waiters = Ember.A();
    }
    this.waiters.push([context, callback]);
  },
  /**
     `unregisterWaiter` is used to unregister a callback that was
     registered with `registerWaiter`.

     @public
     @method unregisterWaiter
     @param {Object} context (optional)
     @param {Function} callback
  */
  unregisterWaiter: function(context, callback) {
    var pair;
    if (!this.waiters) { return; }
    if (arguments.length === 1) {
      callback = context;
      context = null;
    }
    pair = [context, callback];
    this.waiters = Ember.A(this.waiters.filter(function(elt) {
      return Ember.compare(elt, pair)!==0;
    }));
  }
};

function helper(app, name) {
  var fn = helpers[name].method,
      meta = helpers[name].meta;

  return function() {
    var args = slice.call(arguments),
        lastPromise = Ember.Test.lastPromise;

    args.unshift(app);

    // some helpers are not async and
    // need to return a value immediately.
    // example: `find`
    if (!meta.wait) {
      return fn.apply(app, args);
    }

    if (!lastPromise) {
      // It's the first async helper in current context
      lastPromise = fn.apply(app, args);
    } else {
      // wait for last helper's promise to resolve
      // and then execute
      run(function() {
        lastPromise = Ember.Test.resolve(lastPromise).then(function() {
          return fn.apply(app, args);
        });
      });
    }

    return lastPromise;
  };
}

function run(fn) {
  if (!Ember.run.currentRunLoop) {
    Ember.run(fn);
  } else {
    fn();
  }
}

Ember.Application.reopen({
  /**
   This property contains the testing helpers for the current application. These
   are created once you call `injectTestHelpers` on your `Ember.Application`
   instance. The included helpers are also available on the `window` object by
   default, but can be used from this object on the individual application also.

    @property testHelpers
    @type {Object}
    @default {}
  */
  testHelpers: {},

  /**
   This property will contain the original methods that were registered
   on the `helperContainer` before `injectTestHelpers` is called.

   When `removeTestHelpers` is called, these methods are restored to the
   `helperContainer`.

    @property originalMethods
    @type {Object}
    @default {}
    @private
  */
  originalMethods: {},


  /**
  This property indicates whether or not this application is currently in
  testing mode. This is set when `setupForTesting` is called on the current
  application.

  @property testing
  @type {Boolean}
  @default false
  */
  testing: false,

  /**
   This hook defers the readiness of the application, so that you can start
   the app when your tests are ready to run. It also sets the router's
   location to 'none', so that the window's location will not be modified
   (preventing both accidental leaking of state between tests and interference
   with your testing framework).

   Example:

  ```
  App.setupForTesting();
  ```

    @method setupForTesting
  */
  setupForTesting: function() {
    Ember.setupForTesting();

    this.testing = true;

    this.Router.reopen({
      location: 'none'
    });
  },

  /**
    This will be used as the container to inject the test helpers into. By
    default the helpers are injected into `window`.

    @property helperContainer
   @type {Object} The object to be used for test helpers.
   @default window
  */
  helperContainer: window,

  /**
    This injects the test helpers into the `helperContainer` object. If an object is provided
    it will be used as the helperContainer. If `helperContainer` is not set it will default
    to `window`. If a function of the same name has already been defined it will be cached
    (so that it can be reset if the helper is removed with `unregisterHelper` or
    `removeTestHelpers`).

   Any callbacks registered with `onInjectHelpers` will be called once the
   helpers have been injected.

  Example:
  ```
  App.injectTestHelpers();
  ```

    @method injectTestHelpers
  */
  injectTestHelpers: function(helperContainer) {
    if (helperContainer) { this.helperContainer = helperContainer; }

    this.testHelpers = {};
    for (var name in helpers) {
      this.originalMethods[name] = this.helperContainer[name];
      this.testHelpers[name] = this.helperContainer[name] = helper(this, name);
      protoWrap(Ember.Test.Promise.prototype, name, helper(this, name), helpers[name].meta.wait);
    }

    for(var i = 0, l = injectHelpersCallbacks.length; i < l; i++) {
      injectHelpersCallbacks[i](this);
    }
  },

  /**
    This removes all helpers that have been registered, and resets and functions
    that were overridden by the helpers.

    Example:

    ```javascript
    App.removeTestHelpers();
    ```

    @public
    @method removeTestHelpers
  */
  removeTestHelpers: function() {
    for (var name in helpers) {
      this.helperContainer[name] = this.originalMethods[name];
      delete this.testHelpers[name];
      delete this.originalMethods[name];
    }
  }
});

// This method is no longer needed
// But still here for backwards compatibility
// of helper chaining
function protoWrap(proto, name, callback, isAsync) {
  proto[name] = function() {
    var args = arguments;
    if (isAsync) {
      return callback.apply(this, args);
    } else {
      return this.then(function() {
        return callback.apply(this, args);
      });
    }
  };
}

Ember.Test.Promise = function() {
  Ember.RSVP.Promise.apply(this, arguments);
  Ember.Test.lastPromise = this;
};

Ember.Test.Promise.prototype = Ember.create(Ember.RSVP.Promise.prototype);
Ember.Test.Promise.prototype.constructor = Ember.Test.Promise;

// Patch `then` to isolate async methods
// specifically `Ember.Test.lastPromise`
var originalThen = Ember.RSVP.Promise.prototype.then;
Ember.Test.Promise.prototype.then = function(onSuccess, onFailure) {
  return originalThen.call(this, function(val) {
    return isolate(onSuccess, val);
  }, onFailure);
};

// This method isolates nested async methods
// so that they don't conflict with other last promises.
//
// 1. Set `Ember.Test.lastPromise` to null
// 2. Invoke method
// 3. Return the last promise created during method
// 4. Restore `Ember.Test.lastPromise` to original value
function isolate(fn, val) {
  var value, lastPromise;

  // Reset lastPromise for nested helpers
  Ember.Test.lastPromise = null;

  value = fn(val);

  lastPromise = Ember.Test.lastPromise;

  // If the method returned a promise
  // return that promise. If not,
  // return the last async helper's promise
  if ((value && (value instanceof Ember.Test.Promise)) || !lastPromise) {
    return value;
  } else {
    run(function() {
      lastPromise = Ember.Test.resolve(lastPromise).then(function() {
        return value;
      });
    });
    return lastPromise;
  }
}

})();



(function() {
var Test = Ember.Test;

function incrementAjaxPendingRequests(){
  Test.pendingAjaxRequests++;
}

function decrementAjaxPendingRequests(){
  Ember.assert("An ajaxComplete event which would cause the number of pending AJAX " +
               "requests to be negative has been triggered. This is most likely " +
               "caused by AJAX events that were started before calling " +
               "`injectTestHelpers()`.", Test.pendingAjaxRequests !== 0);
  Test.pendingAjaxRequests--;
}

/**
  Sets Ember up for testing. This is useful to perform
  basic setup steps in order to unit test.

  Use `App.setupForTesting` to perform integration tests (full
  application testing).

  @method setupForTesting
  @namespace Ember
*/
Ember.setupForTesting = function() {
  Ember.testing = true;

  // if adapter is not manually set default to QUnit
  if (!Ember.Test.adapter) {
    Ember.Test.adapter = Ember.Test.QUnitAdapter.create();
  }

  if (!Test.pendingAjaxRequests) {
    Test.pendingAjaxRequests = 0;
  }

  Ember.$(document).off('ajaxSend', incrementAjaxPendingRequests);
  Ember.$(document).off('ajaxComplete', decrementAjaxPendingRequests);
  Ember.$(document).on('ajaxSend', incrementAjaxPendingRequests);
  Ember.$(document).on('ajaxComplete', decrementAjaxPendingRequests);
};

})();



(function() {
Ember.onLoad('Ember.Application', function(Application) {
  Application.initializer({
    name: 'deferReadiness in `testing` mode',

    initialize: function(container, application){
      if (application.testing) {
        application.deferReadiness();
      }
    }
  });
});

})();



(function() {
/**
  @module ember
  @submodule ember-testing
 */

var $ = Ember.$;

/**
  This method creates a checkbox and triggers the click event to fire the
  passed in handler. It is used to correct for a bug in older versions
  of jQuery (e.g 1.8.3).

  @private
  @method testCheckboxClick
*/
function testCheckboxClick(handler) {
  $('<input type="checkbox">')
    .css({ position: 'absolute', left: '-1000px', top: '-1000px' })
    .appendTo('body')
    .on('click', handler)
    .trigger('click')
    .remove();
}

$(function() {
  /*
    Determine whether a checkbox checked using jQuery's "click" method will have
    the correct value for its checked property.

    If we determine that the current jQuery version exhibits this behavior,
    patch it to work correctly as in the commit for the actual fix:
    https://github.com/jquery/jquery/commit/1fb2f92.
  */
  testCheckboxClick(function() {
    if (!this.checked && !$.event.special.click) {
      $.event.special.click = {
        // For checkbox, fire native event so checked state will be right
        trigger: function() {
          if ($.nodeName( this, "input" ) && this.type === "checkbox" && this.click) {
            this.click();
            return false;
          }
        }
      };
    }
  });

  // Try again to verify that the patch took effect or blow up.
  testCheckboxClick(function() {
    Ember.warn("clicked checkboxes should be checked! the jQuery patch didn't work", this.checked);
  });
});

})();



(function() {
/**
 @module ember
 @submodule ember-testing
*/

var Test = Ember.Test;

/**
  The primary purpose of this class is to create hooks that can be implemented
  by an adapter for various test frameworks.

  @class Adapter
  @namespace Ember.Test
*/
Test.Adapter = Ember.Object.extend({
  /**
    This callback will be called whenever an async operation is about to start.

    Override this to call your framework's methods that handle async
    operations.

    @public
    @method asyncStart
  */
  asyncStart: Ember.K,

  /**
    This callback will be called whenever an async operation has completed.

    @public
    @method asyncEnd
  */
  asyncEnd: Ember.K,

  /**
    Override this method with your testing framework's false assertion.
    This function is called whenever an exception occurs causing the testing
    promise to fail.

    QUnit example:

    ```javascript
      exception: function(error) {
        ok(false, error);
      };
    ```

    @public
    @method exception
    @param {String} error The exception to be raised.
  */
  exception: function(error) {
    throw error;
  }
});

/**
  This class implements the methods defined by Ember.Test.Adapter for the
  QUnit testing framework.

  @class QUnitAdapter
  @namespace Ember.Test
  @extends Ember.Test.Adapter
*/
Test.QUnitAdapter = Test.Adapter.extend({
  asyncStart: function() {
    stop();
  },
  asyncEnd: function() {
    start();
  },
  exception: function(error) {
    ok(false, Ember.inspect(error));
  }
});

})();



(function() {
/**
* @module ember
* @submodule ember-testing
*/

var get = Ember.get,
    Test = Ember.Test,
    helper = Test.registerHelper,
    asyncHelper = Test.registerAsyncHelper,
    countAsync = 0;

function currentRouteName(app){
  var appController = app.__container__.lookup('controller:application');

  return get(appController, 'currentRouteName');
}

function currentPath(app){
  var appController = app.__container__.lookup('controller:application');

  return get(appController, 'currentPath');
}

function currentURL(app){
  var router = app.__container__.lookup('router:main');

  return get(router, 'location').getURL();
}

function visit(app, url) {
  var router = app.__container__.lookup('router:main');
  router.location.setURL(url);

  if (app._readinessDeferrals > 0) {
    router['initialURL'] = url;
    Ember.run(app, 'advanceReadiness');
    delete router['initialURL'];
  } else {
    Ember.run(app, app.handleURL, url);
  }

  return wait(app);
}

function click(app, selector, context) {
  var $el = findWithAssert(app, selector, context);
  Ember.run($el, 'mousedown');

  if ($el.is(':input')) {
    var type = $el.prop('type');
    if (type !== 'checkbox' && type !== 'radio' && type !== 'hidden') {
      Ember.run($el, function(){
        // Firefox does not trigger the `focusin` event if the window
        // does not have focus. If the document doesn't have focus just
        // use trigger('focusin') instead.
        if (!document.hasFocus || document.hasFocus()) {
          this.focus();
        } else {
          this.trigger('focusin');
        }
      });
    }
  }

  Ember.run($el, 'mouseup');
  Ember.run($el, 'click');

  return wait(app);
}

function triggerEvent(app, selector, context, type, options){
  if (arguments.length === 3) {
    type = context;
    context = null;
  }

  if (typeof options === 'undefined') {
    options = {};
  }

  var $el = findWithAssert(app, selector, context);

  var event = Ember.$.Event(type, options);

  Ember.run($el, 'trigger', event);

  return wait(app);
}

function keyEvent(app, selector, context, type, keyCode) {
  if (typeof keyCode === 'undefined') {
    keyCode = type;
    type = context;
    context = null;
  }

  return triggerEvent(app, selector, context, type, { keyCode: keyCode, which: keyCode });
}

function fillIn(app, selector, context, text) {
  var $el;
  if (typeof text === 'undefined') {
    text = context;
    context = null;
  }
  $el = findWithAssert(app, selector, context);
  Ember.run(function() {
    $el.val(text).change();
  });
  return wait(app);
}

function findWithAssert(app, selector, context) {
  var $el = find(app, selector, context);
  if ($el.length === 0) {
    throw new Ember.Error("Element " + selector + " not found.");
  }
  return $el;
}

function find(app, selector, context) {
  var $el;
  context = context || get(app, 'rootElement');
  $el = app.$(selector, context);

  return $el;
}

function andThen(app, callback) {
  return wait(app, callback(app));
}

function wait(app, value) {
  return Test.promise(function(resolve) {
    // If this is the first async promise, kick off the async test
    if (++countAsync === 1) {
      Test.adapter.asyncStart();
    }

    // Every 10ms, poll for the async thing to have finished
    var watcher = setInterval(function() {
      // 1. If the router is loading, keep polling
      // var routerIsLoading = !!app.__container__.lookup('router:main').router.activeTransition;
      // if (routerIsLoading) { return; }

      // 2. If there are pending Ajax requests, keep polling
      if (Test.pendingAjaxRequests) { return; }

      // 3. If there are scheduled timers or we are inside of a run loop, keep polling
      if (Ember.run.hasScheduledTimers() || Ember.run.currentRunLoop) { return; }
      if (Test.waiters && Test.waiters.any(function(waiter) {
        var context = waiter[0];
        var callback = waiter[1];
        return !callback.call(context);
      })) { return; }
      // Stop polling
      clearInterval(watcher);

      // If this is the last async promise, end the async test
      if (--countAsync === 0) {
        Test.adapter.asyncEnd();
      }

      // Synchronously resolve the promise
      Ember.run(null, resolve, value);
    }, 10);
  });

}


/**
* Loads a route, sets up any controllers, and renders any templates associated
* with the route as though a real user had triggered the route change while
* using your app.
*
* Example:
*
* ```javascript
* visit('posts/index').then(function() {
*   // assert something
* });
* ```
*
* @method visit
* @param {String} url the name of the route
* @return {RSVP.Promise}
*/
asyncHelper('visit', visit);

/**
* Clicks an element and triggers any actions triggered by the element's `click`
* event.
*
* Example:
*
* ```javascript
* click('.some-jQuery-selector').then(function() {
*   // assert something
* });
* ```
*
* @method click
* @param {String} selector jQuery selector for finding element on the DOM
* @return {RSVP.Promise}
*/
asyncHelper('click', click);

/**
* Simulates a key event, e.g. `keypress`, `keydown`, `keyup` with the desired keyCode
*
* Example:
*
* ```javascript
* keyEvent('.some-jQuery-selector', 'keypress', 13).then(function() {
*  // assert something
* });
* ```
*
* @method keyEvent
* @param {String} selector jQuery selector for finding element on the DOM
* @param {String} type the type of key event, e.g. `keypress`, `keydown`, `keyup`
* @param {Number} keyCode the keyCode of the simulated key event
* @return {RSVP.Promise}
*/
asyncHelper('keyEvent', keyEvent);

/**
* Fills in an input element with some text.
*
* Example:
*
* ```javascript
* fillIn('#email', 'you@example.com').then(function() {
*   // assert something
* });
* ```
*
* @method fillIn
* @param {String} selector jQuery selector finding an input element on the DOM
* to fill text with
* @param {String} text text to place inside the input element
* @return {RSVP.Promise}
*/
asyncHelper('fillIn', fillIn);

/**
* Finds an element in the context of the app's container element. A simple alias
* for `app.$(selector)`.
*
* Example:
*
* ```javascript
* var $el = find('.my-selector');
* ```
*
* @method find
* @param {String} selector jQuery string selector for element lookup
* @return {Object} jQuery object representing the results of the query
*/
helper('find', find);

/**
* Like `find`, but throws an error if the element selector returns no results.
*
* Example:
*
* ```javascript
* var $el = findWithAssert('.doesnt-exist'); // throws error
* ```
*
* @method findWithAssert
* @param {String} selector jQuery selector string for finding an element within
* the DOM
* @return {Object} jQuery object representing the results of the query
* @throws {Error} throws error if jQuery object returned has a length of 0
*/
helper('findWithAssert', findWithAssert);

/**
  Causes the run loop to process any pending events. This is used to ensure that
  any async operations from other helpers (or your assertions) have been processed.

  This is most often used as the return value for the helper functions (see 'click',
  'fillIn','visit',etc).

  Example:

  ```javascript
  Ember.Test.registerAsyncHelper('loginUser', function(app, username, password) {
    visit('secured/path/here')
    .fillIn('#username', username)
    .fillIn('#password', username)
    .click('.submit')

    return wait();
  });

  @method wait
  @param {Object} value The value to be returned.
  @return {RSVP.Promise}
*/
asyncHelper('wait', wait);
asyncHelper('andThen', andThen);


if (Ember.FEATURES.isEnabled('ember-testing-routing-helpers')){
  /**
    Returns the currently active route name.

    Example:

    ```javascript
    function validateRouteName(){
      equal(currentRouteName(), 'some.path', "correct route was transitioned into.");
    }

    visit('/some/path').then(validateRouteName)
    ```

    @method currentRouteName
    @return {Object} The name of the currently active route.
  */
  helper('currentRouteName', currentRouteName);

  /**
    Returns the current path.

    Example:

    ```javascript
    function validateURL(){
      equal(currentPath(), 'some.path.index', "correct path was transitioned into.");
    }

    click('#some-link-id').then(validateURL);
    ```

    @method currentPath
    @return {Object} The currently active path.
  */
  helper('currentPath', currentPath);

  /**
    Returns the current URL.

    Example:

    ```javascript
    function validateURL(){
      equal(currentURL(), '/some/path', "correct URL was transitioned into.");
    }

    click('#some-link-id').then(validateURL);
    ```

    @method currentURL
    @return {Object} The currently active URL.
  */
  helper('currentURL', currentURL);
}

if (Ember.FEATURES.isEnabled('ember-testing-triggerEvent-helper')) {
  /**
    Triggers the given event on the element identified by the provided selector.

    Example:

    ```javascript
    triggerEvent('#some-elem-id', 'blur');
    ```

    This is actually used internally by the `keyEvent` helper like so:

    ```javascript
    triggerEvent('#some-elem-id', 'keypress', { keyCode: 13 });
    ```

   @method triggerEvent
   @param {String} selector jQuery selector for finding element on the DOM
   @param {String} type The event type to be triggered.
   @param {String} options The options to be passed to jQuery.Event.
   @return {RSVP.Promise}
  */
  asyncHelper('triggerEvent', triggerEvent);
}

})();



(function() {
/**
  Ember Testing

  @module ember
  @submodule ember-testing
  @requires ember-application
*/

})();

