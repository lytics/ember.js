(function() {

var controller, container;

if (Ember.FEATURES.isEnabled("query-params-new")) {

  module("Ember.Controller query param support", {
    setup: function() {

      container = new Ember.Container();

      container.register('controller:thing', Ember.Controller.extend({
        _queryParamScope: 'thing',
        queryParams: ['foo', 'bar:baz'],
        foo: 'imafoo',
        bar: 'imabar'
      }));

      controller = container.lookup('controller:thing');
    },

    teardown: function() {
    }
  });

  test("setting a query param property on an inactive controller does nothing", function() {
    expect(0);

    controller.target = {
      transitionTo: function(params) {
        ok(false, "should not get here");
      }
    };

    Ember.run(controller, 'set', 'foo', 'newfoo');
  });

  test("setting a query param property fires off a transition", function() {
    expect(1);

    controller.target = {
      transitionTo: function(params) {
        deepEqual(params, { queryParams: { 'thing[foo]': 'newfoo' } }, "transitionTo is called");
      }
    };

    Ember.run(controller, '_activateQueryParamObservers');
    Ember.run(controller, 'set', 'foo', 'newfoo');
  });

  test("setting multiple query param properties fires off a single transition", function() {
    expect(1);

    controller.target = {
      transitionTo: function(params) {
        deepEqual(params, { queryParams: { 'thing[foo]': 'newfoo', 'baz': 'newbar' } }, "single transitionTo is called");
      }
    };

    Ember.run(controller, '_activateQueryParamObservers');

    Ember.run(function() {
      controller.set('foo', 'newfoo');
      controller.set('bar', 'newbar');
    });
  });

  test("changing a prop on a deactivated controller does nothing", function() {
    expect(1);

    controller.target = {
      transitionTo: function(params) {
        deepEqual(params, { queryParams: { 'thing[foo]': 'newfoo' } }, "transitionTo is called");
      }
    };

    Ember.run(controller, '_activateQueryParamObservers');
    Ember.run(controller, 'set', 'foo', 'newfoo');
    Ember.run(controller, '_deactivateQueryParamObservers');
    Ember.run(controller, 'set', 'foo', 'nonono');
  });
}

})();

(function() {
var dispatcher, view,
    ActionHelper = Ember.Handlebars.ActionHelper,
    originalRegisterAction = ActionHelper.registerAction;

var appendView = function() {
  Ember.run(function() { view.appendTo('#qunit-fixture'); });
};

module("Ember.Handlebars - action helper", {
  setup: function() {
    dispatcher = Ember.EventDispatcher.create();
    dispatcher.setup();
  },

  teardown: function() {
    Ember.run(function() {
      dispatcher.destroy();
      if (view) { view.destroy(); }
    });

    Ember.TESTING_DEPRECATION = false;
  }
});

test("should output a data attribute with a guid", function() {
  view = Ember.View.create({
    template: Ember.Handlebars.compile('<a href="#" {{action "edit"}}>edit</a>')
  });

  appendView();

  ok(view.$('a').attr('data-ember-action').match(/\d+/), "A data-ember-action attribute with a guid was added");
});

test("should by default register a click event", function() {
  var registeredEventName;

  ActionHelper.registerAction = function(actionName, options) {
    registeredEventName = options.eventName;
  };

  view = Ember.View.create({
    template: Ember.Handlebars.compile('<a href="#" {{action "edit"}}>edit</a>')
  });

  appendView();

  equal(registeredEventName, 'click', "The click event was properly registered");

  ActionHelper.registerAction = originalRegisterAction;
});

test("should allow alternative events to be handled", function() {
  var registeredEventName;

  ActionHelper.registerAction = function(actionName, options) {
    registeredEventName = options.eventName;
  };

  view = Ember.View.create({
    template: Ember.Handlebars.compile('<a href="#" {{action "edit" on="mouseUp"}}>edit</a>')
  });

  appendView();

  equal(registeredEventName, 'mouseUp', "The alternative mouseUp event was properly registered");

  ActionHelper.registerAction = originalRegisterAction;
});

test("should by default target the view's controller", function() {
  var registeredTarget, controller = {};

  ActionHelper.registerAction = function(actionName, options) {
    registeredTarget = options.target;
  };

  view = Ember.View.create({
    controller: controller,
    template: Ember.Handlebars.compile('<a href="#" {{action "edit"}}>edit</a>')
  });

  appendView();

  equal(registeredTarget.root, controller, "The controller was registered as the target");

  ActionHelper.registerAction = originalRegisterAction;
});

test("Inside a yield, the target points at the original target", function() {
  var controller = {}, watted = false;

  var component = Ember.Component.extend({
    boundText: "inner",
    truthy: true,
    obj: {},
    layout: Ember.Handlebars.compile("<p>{{boundText}}</p><p>{{#if truthy}}{{#with obj}}{{yield}}{{/with}}{{/if}}</p>")
  });

  view = Ember.View.create({
    controller: {
      boundText: "outer",
      truthy: true,
      wat: function() {
        watted = true;
      },
      obj: {
        component: component,
        truthy: true,
        boundText: 'insideWith'
      }
    },
    template: Ember.Handlebars.compile('{{#with obj}}{{#if truthy}}{{#view component}}{{#if truthy}}<p {{action "wat"}} class="wat">{{boundText}}</p>{{/if}}{{/view}}{{/if}}{{/with}}')
  });

  appendView();

  Ember.run(function() {
    view.$(".wat").click();
  });

  equal(watted, true, "The action was called on the right context");
});

test("should target the current controller inside an {{each}} loop", function() {
  var registeredTarget;

  ActionHelper.registerAction = function(actionName, options) {
    registeredTarget = options.target;
  };

  var itemController = Ember.ObjectController.create();

  var ArrayController = Ember.ArrayController.extend({
    itemController: 'stub',
    controllerAt: function(idx, object) {
      return itemController;
    }
  });

  var controller = ArrayController.create({
    model: Ember.A([1])
  });

  view = Ember.View.create({
    controller: controller,
    template: Ember.Handlebars.compile('{{#each controller}}{{action "editTodo"}}{{/each}}')
  });

  appendView();

  equal(registeredTarget.root, itemController, "the item controller is the target of action");

  ActionHelper.registerAction = originalRegisterAction;
});

test("should allow a target to be specified", function() {
  var registeredTarget;

  ActionHelper.registerAction = function(actionName, options) {
    registeredTarget = options.target;
  };

  var anotherTarget = Ember.View.create();

  view = Ember.View.create({
    controller: {},
    template: Ember.Handlebars.compile('<a href="#" {{action "edit" target="view.anotherTarget"}}>edit</a>'),
    anotherTarget: anotherTarget
  });

  appendView();

  equal(registeredTarget.options.data.keywords.view, view, "The specified target was registered");
  equal(registeredTarget.target, 'view.anotherTarget', "The specified target was registered");

  ActionHelper.registerAction = originalRegisterAction;

  Ember.run(function() {
    anotherTarget.destroy();
  });
});

test("should lazily evaluate the target", function() {
  var firstEdit = 0, secondEdit = 0;

  var controller = {};
  var first = {
    edit: function() {
      firstEdit++;
    }
  };

  var second = {
    edit: function() {
      secondEdit++;
    }
  };

  controller.theTarget = first;

  view = Ember.View.create({
    controller: controller,
    template: Ember.Handlebars.compile('<a href="#" {{action "edit" target="theTarget"}}>edit</a>')
  });

  appendView();

  Ember.run(function() {
    Ember.$('a').trigger('click');
  });

  equal(firstEdit, 1);

  Ember.set(controller, 'theTarget', second);

  Ember.run(function() {
    Ember.$('a').trigger('click');
  });

  equal(firstEdit, 1);
  equal(secondEdit, 1);
});

test("should register an event handler", function() {
  var eventHandlerWasCalled = false;

  var controller = Ember.Controller.extend({
    actions: { edit: function() { eventHandlerWasCalled = true; } }
  }).create();

  view = Ember.View.create({
    controller: controller,
    template: Ember.Handlebars.compile('<a href="#" {{action "edit"}}>click me</a>')
  });

  appendView();

  var actionId = view.$('a[data-ember-action]').attr('data-ember-action');

  ok(Ember.Handlebars.ActionHelper.registeredActions[actionId], "The action was registered");

  view.$('a').trigger('click');

  ok(eventHandlerWasCalled, "The event handler was called");
});

test("handles whitelisted modifier keys", function() {
  var eventHandlerWasCalled = false, shortcutHandlerWasCalled = false;

  var controller = Ember.Controller.extend({
    actions: {
      edit: function() { eventHandlerWasCalled = true; },
      shortcut: function() { shortcutHandlerWasCalled = true; }
    }
  }).create();

  view = Ember.View.create({
    controller: controller,
    template: Ember.Handlebars.compile('<a href="#" {{action "edit" allowedKeys="alt"}}>click me</a> <div {{action "shortcut" allowedKeys="any"}}>click me too</div>')
  });

  appendView();

  var actionId = view.$('a[data-ember-action]').attr('data-ember-action');

  ok(Ember.Handlebars.ActionHelper.registeredActions[actionId], "The action was registered");

  var e = Ember.$.Event('click');
  e.altKey = true;
  view.$('a').trigger(e);

  ok(eventHandlerWasCalled, "The event handler was called");

  e = Ember.$.Event('click');
  e.ctrlKey = true;
  view.$('div').trigger(e);

  ok(shortcutHandlerWasCalled, "The \"any\" shortcut's event handler was called");
});

test("should be able to use action more than once for the same event within a view", function() {
  var editWasCalled = false,
      deleteWasCalled = false,
      originalEventHandlerWasCalled = false;

  var controller = Ember.Controller.extend({
    actions: {
      edit: function() { editWasCalled = true; },
      "delete": function() { deleteWasCalled = true; }
    }
  }).create();

  view = Ember.View.create({
    controller: controller,
    template: Ember.Handlebars.compile(
      '<a id="edit" href="#" {{action "edit"}}>edit</a><a id="delete" href="#" {{action "delete"}}>delete</a>'
    ),
    click: function() { originalEventHandlerWasCalled = true; }
  });

  appendView();

  view.$('#edit').trigger('click');

  equal(editWasCalled, true, "The edit action was called");
  equal(deleteWasCalled, false, "The delete action was not called");

  editWasCalled = deleteWasCalled = originalEventHandlerWasCalled = false;

  view.$('#delete').trigger('click');

  equal(editWasCalled, false, "The edit action was not called");
  equal(deleteWasCalled, true, "The delete action was called");

  editWasCalled = deleteWasCalled = originalEventHandlerWasCalled = false;

  view.$().trigger('click');

  equal(editWasCalled, false, "The edit action was not called");
  equal(deleteWasCalled, false, "The delete action was not called");
});

test("the event should not bubble if `bubbles=false` is passed", function() {
  var editWasCalled = false,
      deleteWasCalled = false,
      originalEventHandlerWasCalled = false;

  var controller = Ember.Controller.extend({
    actions: {
      edit: function() { editWasCalled = true; },
      "delete": function() { deleteWasCalled = true; }
    }
  }).create();

  view = Ember.View.create({
    controller: controller,
    template: Ember.Handlebars.compile(
      '<a id="edit" href="#" {{action "edit" bubbles=false}}>edit</a><a id="delete" href="#" {{action "delete" bubbles=false}}>delete</a>'
    ),
    click: function() { originalEventHandlerWasCalled = true; }
  });

  appendView();

  view.$('#edit').trigger('click');

  equal(editWasCalled, true, "The edit action was called");
  equal(deleteWasCalled, false, "The delete action was not called");
  equal(originalEventHandlerWasCalled, false, "The original event handler was not called");

  editWasCalled = deleteWasCalled = originalEventHandlerWasCalled = false;

  view.$('#delete').trigger('click');

  equal(editWasCalled, false, "The edit action was not called");
  equal(deleteWasCalled, true, "The delete action was called");
  equal(originalEventHandlerWasCalled, false, "The original event handler was not called");

  editWasCalled = deleteWasCalled = originalEventHandlerWasCalled = false;

  view.$().trigger('click');

  equal(editWasCalled, false, "The edit action was not called");
  equal(deleteWasCalled, false, "The delete action was not called");
  equal(originalEventHandlerWasCalled, true, "The original event handler was called");
});

test("should work properly in an #each block", function() {
  var eventHandlerWasCalled = false;

  var controller = Ember.Controller.extend({
    actions: { edit: function() { eventHandlerWasCalled = true; } }
  }).create();

  view = Ember.View.create({
    controller: controller,
    items: Ember.A([1, 2, 3, 4]),
    template: Ember.Handlebars.compile('{{#each view.items}}<a href="#" {{action "edit"}}>click me</a>{{/each}}')
  });

  appendView();

  view.$('a').trigger('click');

  ok(eventHandlerWasCalled, "The event handler was called");
});

test("should work properly in a #with block", function() {
  var eventHandlerWasCalled = false;

  var controller = Ember.Controller.extend({
    actions: { edit: function() { eventHandlerWasCalled = true; } }
  }).create();

  view = Ember.View.create({
    controller: controller,
    something: {ohai: 'there'},
    template: Ember.Handlebars.compile('{{#with view.something}}<a href="#" {{action "edit"}}>click me</a>{{/with}}')
  });

  appendView();

  view.$('a').trigger('click');

  ok(eventHandlerWasCalled, "The event handler was called");
});

test("should unregister event handlers on rerender", function() {
  var eventHandlerWasCalled = false;

  view = Ember.View.extend({
    template: Ember.Handlebars.compile('<a href="#" {{action "edit"}}>click me</a>'),
    actions: { edit: function() { eventHandlerWasCalled = true; } }
  }).create();

  appendView();

  var previousActionId = view.$('a[data-ember-action]').attr('data-ember-action');

  Ember.run(function() {
    view.rerender();
  });

  ok(!Ember.Handlebars.ActionHelper.registeredActions[previousActionId], "On rerender, the event handler was removed");

  var newActionId = view.$('a[data-ember-action]').attr('data-ember-action');

  ok(Ember.Handlebars.ActionHelper.registeredActions[newActionId], "After rerender completes, a new event handler was added");
});

test("should unregister event handlers on inside virtual views", function() {
  var things = Ember.A([
    {
      name: 'Thingy'
    }
  ]);
  view = Ember.View.create({
    template: Ember.Handlebars.compile('{{#each view.things}}<a href="#" {{action "edit"}}>click me</a>{{/each}}'),
    things: things
  });

  appendView();

  var actionId = view.$('a[data-ember-action]').attr('data-ember-action');

  Ember.run(function() {
    things.removeAt(0);
  });

  ok(!Ember.Handlebars.ActionHelper.registeredActions[actionId], "After the virtual view was destroyed, the action was unregistered");
});

test("should properly capture events on child elements of a container with an action", function() {
  var eventHandlerWasCalled = false;

  var controller = Ember.Controller.extend({
    actions: { edit: function() { eventHandlerWasCalled = true; } }
  }).create();

  view = Ember.View.create({
    controller: controller,
    template: Ember.Handlebars.compile('<div {{action "edit"}}><button>click me</button></div>')
  });

  appendView();

  view.$('button').trigger('click');

  ok(eventHandlerWasCalled, "Event on a child element triggered the action of it's parent");
});

test("should allow bubbling of events from action helper to original parent event", function() {
  var eventHandlerWasCalled = false,
      originalEventHandlerWasCalled = false;

  var controller = Ember.Controller.extend({
    actions: { edit: function() { eventHandlerWasCalled = true; } }
  }).create();

  view = Ember.View.create({
    controller: controller,
    template: Ember.Handlebars.compile('<a href="#" {{action "edit"}}>click me</a>'),
    click: function() { originalEventHandlerWasCalled = true; }
  });

  appendView();

  view.$('a').trigger('click');

  ok(eventHandlerWasCalled && originalEventHandlerWasCalled, "Both event handlers were called");
});

test("should not bubble an event from action helper to original parent event if `bubbles=false` is passed", function() {
  var eventHandlerWasCalled = false,
      originalEventHandlerWasCalled = false;

  var controller = Ember.Controller.extend({
    actions: { edit: function() { eventHandlerWasCalled = true; } }
  }).create();

  view = Ember.View.create({
    controller: controller,
    template: Ember.Handlebars.compile('<a href="#" {{action "edit" bubbles=false}}>click me</a>'),
    click: function() { originalEventHandlerWasCalled = true; }
  });

  appendView();

  view.$('a').trigger('click');

  ok(eventHandlerWasCalled, "The child handler was called");
  ok(!originalEventHandlerWasCalled, "The parent handler was not called");
});

test("should allow 'send' as action name (#594)", function() {
  var eventHandlerWasCalled = false;
  var eventObjectSent;

  var controller = Ember.Controller.extend({
    send: function() { eventHandlerWasCalled = true; }
  }).create();

  view = Ember.View.create({
    controller: controller,
    template: Ember.Handlebars.compile('<a href="#" {{action "send" }}>send</a>')
  });

  appendView();

  view.$('a').trigger('click');

  ok(eventHandlerWasCalled, "The view's send method was called");
});


test("should send the view, event and current Handlebars context to the action", function() {
  var passedTarget;
  var passedContext;

  var aTarget = Ember.Controller.extend({
    actions: {
      edit: function(context) {
        passedTarget = this;
        passedContext = context;
      }
    }
  }).create();

  var aContext = { aTarget: aTarget };

  view = Ember.View.create({
    aContext: aContext,
    template: Ember.Handlebars.compile('{{#with view.aContext}}<a id="edit" href="#" {{action "edit" this target="aTarget"}}>edit</a>{{/with}}')
  });

  appendView();

  view.$('#edit').trigger('click');

  strictEqual(passedTarget, aTarget, "the action is called with the target as this");
  strictEqual(passedContext, aContext, "the parameter is passed along");
});

test("should only trigger actions for the event they were registered on", function() {
  var editWasCalled = false;

  view = Ember.View.extend({
    template: Ember.Handlebars.compile('<a href="#" {{action "edit"}}>edit</a>'),
    actions: { edit: function() { editWasCalled = true; } }
  }).create();

  appendView();

  view.$('a').trigger('mouseover');

  ok(!editWasCalled, "The action wasn't called");
});

test("should unwrap controllers passed as a context", function() {
  var passedContext,
      model = Ember.Object.create(),
      controller = Ember.ObjectController.extend({
        model: model,
        actions: {
          edit: function(context) {
            passedContext = context;
          }
        }
      }).create();

  view = Ember.View.create({
    controller: controller,
    template: Ember.Handlebars.compile('<button {{action "edit" this}}>edit</button>')
  });

  appendView();

  view.$('button').trigger('click');

  equal(passedContext, model, "the action was passed the unwrapped model");
});

test("should allow multiple contexts to be specified", function() {
  var passedContexts,
      models = [Ember.Object.create(), Ember.Object.create()];

  var controller = Ember.Controller.extend({
    actions: {
      edit: function() {
        passedContexts = [].slice.call(arguments);
      }
    }
  }).create();

  view = Ember.View.create({
    controller: controller,
    modelA: models[0],
    modelB: models[1],
    template: Ember.Handlebars.compile('<button {{action "edit" view.modelA view.modelB}}>edit</button>')
  });

  appendView();

  view.$('button').trigger('click');

  deepEqual(passedContexts, models, "the action was called with the passed contexts");
});

test("should allow multiple contexts to be specified mixed with string args", function() {
  var passedParams,
      model = Ember.Object.create();

  var controller = Ember.Controller.extend({
    actions: {
      edit: function() {
        passedParams = [].slice.call(arguments);
      }
    }
  }).create();

  view = Ember.View.create({
    controller: controller,
    modelA: model,
    template: Ember.Handlebars.compile('<button {{action "edit" "herp" view.modelA}}>edit</button>')
  });

  appendView();

  view.$('button').trigger('click');

  deepEqual(passedParams, ["herp", model], "the action was called with the passed contexts");
});

var namespace = {
  "Component": {
    toString: function() { return "Component"; },
    find: function() { return { id: 1 }; }
  }
};

var compile = function(string) {
  return Ember.Handlebars.compile(string);
};

test("it does not trigger action with special clicks", function() {
  var showCalled = false;

  view = Ember.View.create({
    template: compile("<a {{action 'show' href=true}}>Hi</a>")
  });

  var controller = Ember.Controller.extend({
    actions: {
      show: function() {
        showCalled = true;
      }
    }
  }).create();

  Ember.run(function() {
    view.set('controller', controller);
    view.appendTo('#qunit-fixture');
  });

  function checkClick(prop, value, expected) {
    var event = Ember.$.Event("click");
    event[prop] = value;
    view.$('a').trigger(event);
    if (expected) {
      ok(showCalled, "should call action with "+prop+":"+value);
      ok(event.isDefaultPrevented(), "should prevent default");
    } else {
      ok(!showCalled, "should not call action with "+prop+":"+value);
      ok(!event.isDefaultPrevented(), "should not prevent default");
    }
  }

  checkClick('ctrlKey', true, false);
  checkClick('altKey', true, false);
  checkClick('metaKey', true, false);
  checkClick('shiftKey', true, false);
  checkClick('which', 2, false);

  checkClick('which', 1, true);
  checkClick('which', undefined, true); // IE <9
});

test("it can trigger actions for keyboard events", function() {
  var showCalled = false;

  view = Ember.View.create({
    template: compile("<input type='text' {{action 'show' on='keyUp'}}>")
  });

  var controller = Ember.Controller.extend({
    actions: {
      show: function() {
        showCalled = true;
      }
    }
  }).create();

  Ember.run(function() {
    view.set('controller', controller);
    view.appendTo('#qunit-fixture');
  });

  var event = Ember.$.Event("keyup");
  event.char = 'a';
  event.which = 65;
  view.$('input').trigger(event);
  ok(showCalled, "should call action with keyup");
});

if (Ember.FEATURES.isEnabled("ember-routing-bound-action-name")) {
  test("a quoteless parameter should allow dynamic lookup of the actionName", function(){
    expect(4);
    var lastAction, actionOrder = [];

    view = Ember.View.create({
      template: compile("<a id='woot-bound-param'' {{action hookMeUp}}>Hi</a>")
    });

    var controller = Ember.Controller.extend({
      hookMeUp: 'biggityBoom',
      actions: {
        biggityBoom: function() {
          lastAction = 'biggityBoom';
          actionOrder.push(lastAction);
        },
        whompWhomp: function() {
          lastAction = 'whompWhomp';
          actionOrder.push(lastAction);
        },
        sloopyDookie: function(){
          lastAction = 'sloopyDookie';
          actionOrder.push(lastAction);
        }
      }
    }).create();

    Ember.run(function() {
      view.set('controller', controller);
      view.appendTo('#qunit-fixture');
    });

    var testBoundAction = function(propertyValue){
      controller.set('hookMeUp', propertyValue);

      Ember.run(function(){
        view.$("#woot-bound-param").click();
      });

      equal(lastAction, propertyValue, 'lastAction set to ' + propertyValue);
    };

    testBoundAction('whompWhomp');
    testBoundAction('sloopyDookie');
    testBoundAction('biggityBoom');

    deepEqual(actionOrder, ['whompWhomp', 'sloopyDookie', 'biggityBoom'], 'action name was looked up properly');
  });

  test("a quoteless parameter that also exists as an action name functions properly", function(){
    Ember.TESTING_DEPRECATION = true;
    var triggeredAction;

    view = Ember.View.create({
      template: compile("<a id='oops-bound-param'' {{action ohNoeNotValid}}>Hi</a>")
    });

    var controller = Ember.Controller.extend({
      actions: {
        ohNoeNotValid: function() {
          triggeredAction = true;
        }
      }
    }).create();

    Ember.run(function() {
      view.set('controller', controller);
      view.appendTo('#qunit-fixture');
    });

    Ember.run(function(){
      view.$("#oops-bound-param").click();
    });

    ok(triggeredAction, 'the action was triggered');
  });

  test("a quoteless parameter that also exists as an action name results in an assertion", function(){
    var triggeredAction;

    view = Ember.View.create({
      template: compile("<a id='oops-bound-param' {{action ohNoeNotValid}}>Hi</a>")
    });

    var controller = Ember.Controller.extend({
      actions: {
        ohNoeNotValid: function() {
          triggeredAction = true;
        }
      }
    }).create();

    Ember.run(function() {
      view.set('controller', controller);
      view.appendTo('#qunit-fixture');
    });

    var oldAssert = Ember.assert;
    Ember.assert = function(message, test){
      ok(test, message + " -- was properly asserted");
    };

    Ember.run(function(){
      view.$("#oops-bound-param").click();
    });

    ok(triggeredAction, 'the action was triggered');

    Ember.assert = oldAssert;
  });

  test("a quoteless parameter that also exists as an action name in deprecated action in controller style results in an assertion", function(){
    var dropDeprecatedActionStyleOrig = Ember.FEATURES['ember-routing-drop-deprecated-action-style'];
    Ember.FEATURES['ember-routing-drop-deprecated-action-style'] = false;

    var triggeredAction;

    view = Ember.View.create({
      template: compile("<a id='oops-bound-param' {{action ohNoeNotValid}}>Hi</a>")
    });

    var controller = Ember.Controller.extend({
      ohNoeNotValid: function() {
        triggeredAction = true;
      }
    }).create();

    Ember.run(function() {
      view.set('controller', controller);
      view.appendTo('#qunit-fixture');
    });

    var oldAssert = Ember.assert;
    Ember.assert = function(message, test){
      ok(test, message + " -- was properly asserted");
    };

    Ember.run(function(){
      view.$("#oops-bound-param").click();
    });

    ok(triggeredAction, 'the action was triggered');

    Ember.assert = oldAssert;
    Ember.FEATURES['ember-routing-drop-deprecated-action-style'] = dropDeprecatedActionStyleOrig;
  });
} else {
  test("a quoteless parameter as an action name", function(){
    expect(2);

    expectDeprecation("Using a quoteless parameter with {{action}} is deprecated. Please update to quoted usage '{{action \"ohNoeNotValid\"}}.");

    var triggeredAction;

    view = Ember.View.create({
      template: compile("<a id='oops-bound-param'' {{action ohNoeNotValid}}>Hi</a>")
    });

    var controller = Ember.Controller.extend({
      actions: {
        ohNoeNotValid: function() {
          triggeredAction = true;
        }
      }
    }).create();

    Ember.run(function() {
      view.set('controller', controller);
      view.appendTo('#qunit-fixture');
    });

    Ember.run(function(){
      view.$("#oops-bound-param").click();
    });

    ok(triggeredAction, 'the action was triggered');
  });
}

module("Ember.Handlebars - action helper - deprecated invoking directly on target", {
  setup: function() {
    dispatcher = Ember.EventDispatcher.create();
    dispatcher.setup();
  },

  teardown: function() {
    Ember.run(function() {
      dispatcher.destroy();
      if (view) { view.destroy(); }
    });
  }
});

if (!Ember.FEATURES.isEnabled('ember-routing-drop-deprecated-action-style')) {
  test("should invoke a handler defined directly on the target (DEPRECATED)", function() {
    var eventHandlerWasCalled,
        model = Ember.Object.create();

    var controller = Ember.Controller.extend({
      edit: function() {
        eventHandlerWasCalled = true;
      }
    }).create();

    view = Ember.View.create({
      controller: controller,
      template: Ember.Handlebars.compile('<button {{action "edit"}}>edit</button>')
    });

    appendView();

    expectDeprecation(/Action handlers implemented directly on controllers are deprecated/);

    view.$('button').trigger('click');

    ok(eventHandlerWasCalled, "the action was called");
  });
}

test("should respect preventDefault=false option if provided", function(){
  view = Ember.View.create({
    template: compile("<a {{action 'show' preventDefault=false}}>Hi</a>")
  });

  var controller = Ember.Controller.extend({
    actions: {
      show: function() { }
    }
  }).create();

  Ember.run(function() {
    view.set('controller', controller);
    view.appendTo('#qunit-fixture');
  });

  var event = Ember.$.Event("click");
  view.$('a').trigger(event);

  equal(event.isDefaultPrevented(), false, "should not preventDefault");
});

})();

(function() {
var buildContainer = function(namespace) {
  var container = new Ember.Container();

  container.set = Ember.set;
  container.resolver = resolverFor(namespace);
  container.optionsForType('view', { singleton: false });
  container.optionsForType('template', { instantiate: false });
  container.register('application:main', namespace, { instantiate: false });
  container.injection('router:main', 'namespace', 'application:main');

  container.register('location:hash', Ember.HashLocation);

  container.register('controller:basic', Ember.Controller, { instantiate: false });
  container.register('controller:object', Ember.ObjectController, { instantiate: false });
  container.register('controller:array', Ember.ArrayController, { instantiate: false });

  container.typeInjection('route', 'router', 'router:main');

  return container;
};

function resolverFor(namespace) {
  return function(fullName) {
    var nameParts = fullName.split(":"),
        type = nameParts[0], name = nameParts[1];

    if (type === 'template') {
      var templateName = Ember.String.decamelize(name);
      if (Ember.TEMPLATES[templateName]) {
        return Ember.TEMPLATES[templateName];
      }
    }

    var className = Ember.String.classify(name) + Ember.String.classify(type);
    var factory = Ember.get(namespace, className);

    if (factory) { return factory; }
  };
}

var appendView = function(view) {
  Ember.run(function() { view.appendTo('#qunit-fixture'); });
};

var compile = Ember.Handlebars.compile;
var trim = Ember.$.trim;

var view, container;

module("Handlebars {{outlet}} helpers", {

  setup: function() {
    var namespace = Ember.Namespace.create();
    container = buildContainer(namespace);
    container.register('view:default', Ember.View.extend());
    container.register('router:main', Ember.Router.extend());
  },
  teardown: function() {
    Ember.run(function () {
      if (container) {
        container.destroy();
      }
      if (view) {
        view.destroy();
      }
    });
  }
});

test("view should support connectOutlet for the main outlet", function() {
  var template = "<h1>HI</h1>{{outlet}}";
  view = Ember.View.create({
    template: Ember.Handlebars.compile(template)
  });

  appendView(view);

  equal(view.$().text(), 'HI');

  Ember.run(function() {
    view.connectOutlet('main', Ember.View.create({
      template: compile("<p>BYE</p>")
    }));
  });

  // Replace whitespace for older IE
  equal(trim(view.$().text()), 'HIBYE');
});

test("outlet should support connectOutlet in slots in prerender state", function() {
  var template = "<h1>HI</h1>{{outlet}}";
  view = Ember.View.create({
    template: Ember.Handlebars.compile(template)
  });

  view.connectOutlet('main', Ember.View.create({
    template: compile("<p>BYE</p>")
  }));

  appendView(view);

  equal(view.$().text(), 'HIBYE');
});

test("outlet should support an optional name", function() {
  var template = "<h1>HI</h1>{{outlet mainView}}";
  view = Ember.View.create({
    template: Ember.Handlebars.compile(template)
  });

  appendView(view);

  equal(view.$().text(), 'HI');

  Ember.run(function() {
    view.connectOutlet('mainView', Ember.View.create({
      template: compile("<p>BYE</p>")
    }));
  });

  // Replace whitespace for older IE
  equal(trim(view.$().text()), 'HIBYE');
});


test("outlet should correctly lookup a view", function() {

  var template,
      ContainerView,
      childView;

  ContainerView = Ember.ContainerView.extend();

  container.register("view:containerView", ContainerView);

  template = "<h1>HI</h1>{{outlet view='containerView'}}";

  view = Ember.View.create({
    template: Ember.Handlebars.compile(template),
    container : container
  });

  childView = Ember.View.create({
    template: compile("<p>BYE</p>")
  });

  appendView(view);

  equal(view.$().text(), 'HI');

  Ember.run(function() {
    view.connectOutlet('main', childView);
  });

  ok(ContainerView.detectInstance(childView.get('_parentView')), "The custom view class should be used for the outlet");

  // Replace whitespace for older IE
  equal(trim(view.$().text()), 'HIBYE');

});

test("outlet should assert view is specified as a string", function() {

  var template = "<h1>HI</h1>{{outlet view=containerView}}";

  expectAssertion(function () {

    view = Ember.View.create({
      template: Ember.Handlebars.compile(template),
      container : container
    });

    appendView(view);

  });

});

test("outlet should assert view path is successfully resolved", function() {

  var template = "<h1>HI</h1>{{outlet view='someViewNameHere'}}";

  expectAssertion(function () {

    view = Ember.View.create({
      template: Ember.Handlebars.compile(template),
      container : container
    });

    appendView(view);

  });

});

test("outlet should support an optional view class", function() {
  var template = "<h1>HI</h1>{{outlet viewClass=view.outletView}}";
  view = Ember.View.create({
    template: Ember.Handlebars.compile(template),
    outletView: Ember.ContainerView.extend()
  });

  appendView(view);

  equal(view.$().text(), 'HI');

  var childView = Ember.View.create({
    template: compile("<p>BYE</p>")
  });

  Ember.run(function() {
    view.connectOutlet('main', childView);
  });

  ok(view.outletView.detectInstance(childView.get('_parentView')), "The custom view class should be used for the outlet");

  // Replace whitespace for older IE
  equal(trim(view.$().text()), 'HIBYE');
});


test("Outlets bind to the current view, not the current concrete view", function() {
  var parentTemplate = "<h1>HI</h1>{{outlet}}";
  var middleTemplate = "<h2>MIDDLE</h2>{{outlet}}";
  var bottomTemplate = "<h3>BOTTOM</h3>";

  view = Ember.View.create({
    template: compile(parentTemplate)
  });

  var middleView = Ember._MetamorphView.create({
    template: compile(middleTemplate)
  });

  var bottomView = Ember._MetamorphView.create({
    template: compile(bottomTemplate)
  });

  appendView(view);

  Ember.run(function() {
    view.connectOutlet('main', middleView);
  });

  Ember.run(function() {
    middleView.connectOutlet('main', bottomView);
  });

  var output = Ember.$('#qunit-fixture h1 ~ h2 ~ h3').text();
  equal(output, "BOTTOM", "all templates were rendered");
});

test("view should support disconnectOutlet for the main outlet", function() {
  var template = "<h1>HI</h1>{{outlet}}";
  view = Ember.View.create({
    template: Ember.Handlebars.compile(template)
  });

  appendView(view);

  equal(view.$().text(), 'HI');

  Ember.run(function() {
    view.connectOutlet('main', Ember.View.create({
      template: compile("<p>BYE</p>")
    }));
  });

  // Replace whitespace for older IE
  equal(trim(view.$().text()), 'HIBYE');

  Ember.run(function() {
    view.disconnectOutlet('main');
  });

  // Replace whitespace for older IE
  equal(trim(view.$().text()), 'HI');
});

test("Outlets bind to the current template's view, not inner contexts", function() {
  var parentTemplate = "<h1>HI</h1>{{#if view.alwaysTrue}}{{#with this}}{{outlet}}{{/with}}{{/if}}";
  var bottomTemplate = "<h3>BOTTOM</h3>";

  view = Ember.View.create({
    alwaysTrue: true,
    template: compile(parentTemplate)
  });

  var bottomView = Ember._MetamorphView.create({
    template: compile(bottomTemplate)
  });

  appendView(view);

  Ember.run(function() {
    view.connectOutlet('main', bottomView);
  });

  var output = Ember.$('#qunit-fixture h1 ~ h3').text();
  equal(output, "BOTTOM", "all templates were rendered");
});

test("should support layouts", function() {
  var template = "{{outlet}}",
      layout = "<h1>HI</h1>{{yield}}";
  view = Ember.View.create({
    template: Ember.Handlebars.compile(template),
    layout: Ember.Handlebars.compile(layout)
  });

  appendView(view);

  equal(view.$().text(), 'HI');

  Ember.run(function() {
    view.connectOutlet('main', Ember.View.create({
      template: compile("<p>BYE</p>")
    }));
  });
  // Replace whitespace for older IE
  equal(trim(view.$().text()), 'HIBYE');
});

})();

(function() {
var appendView = function(view) {
  Ember.run(function() { view.appendTo('#qunit-fixture'); });
};

var set = function(object, key, value) {
  Ember.run(function() { Ember.set(object, key, value); });
};

var compile = function(template) {
  return Ember.Handlebars.compile(template);
};

var buildContainer = function(namespace) {
  var container = new Ember.Container();

  container.set = Ember.set;
  container.resolver = resolverFor(namespace);
  container.optionsForType('view', { singleton: false });
  container.optionsForType('template', { instantiate: false });
  container.register('application:main', namespace, { instantiate: false });
  container.injection('router:main', 'namespace', 'application:main');

  container.register('location:hash', Ember.HashLocation);

  container.register('controller:basic', Ember.Controller, { instantiate: false });
  container.register('controller:object', Ember.ObjectController, { instantiate: false });
  container.register('controller:array', Ember.ArrayController, { instantiate: false });

  container.typeInjection('route', 'router', 'router:main');

  return container;
};

function resolverFor(namespace) {
  return function(fullName) {
    var nameParts = fullName.split(":"),
        type = nameParts[0], name = nameParts[1];

    if (type === 'template') {
      var templateName = Ember.String.decamelize(name);
      if (Ember.TEMPLATES[templateName]) {
        return Ember.TEMPLATES[templateName];
      }
    }

    var className = Ember.String.classify(name) + Ember.String.classify(type);
    var factory = Ember.get(namespace, className);

    if (factory) { return factory; }
  };
}

var view, container;

module("Handlebars {{render}} helper", {
  setup: function() {
    var namespace = Ember.Namespace.create();
    container = buildContainer(namespace);
    container.register('view:default', Ember.View.extend());
    container.register('router:main', Ember.Router.extend());
  },
  teardown: function() {
    Ember.run(function () {
      if (container) {
        container.destroy();
      }
      if (view) {
        view.destroy();
      }
    });

    Ember.TEMPLATES = {};
  }
});

test("{{render}} helper should render given template", function() {
  var template = "<h1>HI</h1>{{render 'home'}}";
  var controller = Ember.Controller.extend({container: container});
  view = Ember.View.create({
    controller: controller.create(),
    template: Ember.Handlebars.compile(template)
  });

  Ember.TEMPLATES['home'] = compile("<p>BYE</p>");

  appendView(view);

  equal(view.$().text(), 'HIBYE');
  ok(container.lookup('router:main')._lookupActiveView('home'), 'should register home as active view');
});

test("{{render}} helper should have assertion if neither template nor view exists", function() {
  var template = "<h1>HI</h1>{{render 'oops'}}";
  var controller = Ember.Controller.extend({container: container});
  view = Ember.View.create({
    controller: controller.create(),
    template: Ember.Handlebars.compile(template)
  });

  expectAssertion(function() {
    appendView(view);
  }, 'You used `{{render \'oops\'}}`, but \'oops\' can not be found as either a template or a view.');
});

test("{{render}} helper should not have assertion if template is supplied in block-form", function() {
  var template = "<h1>HI</h1>{{#render 'good'}} {{name}}{{/render}}";
  var controller = Ember.Controller.extend({container: container});
  container.register('controller:good', Ember.Controller.extend({ name: 'Rob'}));
  view = Ember.View.create({
    controller: controller.create(),
    template: Ember.Handlebars.compile(template)
  });

  appendView(view);

  equal(view.$().text(), 'HI Rob');
});

test("{{render}} helper should not have assertion if view exists without a template", function() {
  var template = "<h1>HI</h1>{{render 'oops'}}";
  var controller = Ember.Controller.extend({container: container});
  view = Ember.View.create({
    controller: controller.create(),
    template: Ember.Handlebars.compile(template)
  });

  container.register('view:oops', Ember.View.extend());

  appendView(view);

  equal(view.$().text(), 'HI');
});

test("{{render}} helper should render given template with a supplied model", function() {
  var template = "<h1>HI</h1>{{render 'post' post}}";
  var post = {
    title: "Rails is omakase"
  };

  var Controller = Ember.Controller.extend({
    container: container,
    post: post
  });

  var controller = Controller.create({
  });

  view = Ember.View.create({
    controller: controller,
    template: Ember.Handlebars.compile(template)
  });

  var PostController = Ember.ObjectController.extend();
  container.register('controller:post', PostController);

  Ember.TEMPLATES['post'] = compile("<p>{{title}}</p>");

  appendView(view);

  var postController = view.get('_childViews')[0].get('controller');

  equal(view.$().text(), 'HIRails is omakase');
  equal(postController.get('model'), post);

  set(controller, 'post', { title: "Rails is unagi" });

  equal(view.$().text(), 'HIRails is unagi');
  if (Ember.create.isSimulated) {
    equal(postController.get('model').title, "Rails is unagi");
  } else {
    deepEqual(postController.get('model'), { title: "Rails is unagi" });
  }
});

test("{{render}} helper with a supplied model should not fire observers on the controller", function () {
  var template = "<h1>HI</h1>{{render 'post' post}}";
  var post = {
    title: "Rails is omakase"
  };

  view = Ember.View.create({
    controller: Ember.Controller.create({
      container: container,
      post: post
    }),
    template: Ember.Handlebars.compile(template)
  });

  var PostController = Ember.ObjectController.extend({
    contentDidChange: Ember.observer('content', function(){
      contentDidChange++;
    })
  });

  container.register('controller:post', PostController);

  Ember.TEMPLATES['post'] = compile("<p>{{title}}</p>");

  var contentDidChange = 0;
  appendView(view);
  equal(contentDidChange, 0, "content observer did not fire");

});

test("{{render}} helper should raise an error when a given controller name does not resolve to a controller", function() {
  var template = '<h1>HI</h1>{{render "home" controller="postss"}}';
  var controller = Ember.Controller.extend({container: container});
  container.register('controller:posts', Ember.ArrayController.extend());
  view = Ember.View.create({
    controller: controller.create(),
    template: Ember.Handlebars.compile(template)
  });

  Ember.TEMPLATES['home'] = compile("<p>BYE</p>");

  expectAssertion(function() {
    appendView(view);
  }, 'The controller name you supplied \'postss\' did not resolve to a controller.');
});

test("{{render}} helper should render with given controller", function() {
  var template = '<h1>HI</h1>{{render "home" controller="posts"}}';
  var controller = Ember.Controller.extend({container: container});
  container.register('controller:posts', Ember.ArrayController.extend());
  view = Ember.View.create({
    controller: controller.create(),
    template: Ember.Handlebars.compile(template)
  });

  Ember.TEMPLATES['home'] = compile("<p>BYE</p>");

  appendView(view);

  var renderedView = container.lookup('router:main')._lookupActiveView('home');
  equal(container.lookup('controller:posts'), renderedView.get('controller'), 'rendered with correct controller');
});

test("{{render}} helper should render a template without a model only once", function() {
  var template = "<h1>HI</h1>{{render 'home'}}<hr/>{{render home}}";
  var controller = Ember.Controller.extend({container: container});
  view = Ember.View.create({
    controller: controller.create(),
    template: Ember.Handlebars.compile(template)
  });

  Ember.TEMPLATES['home'] = compile("<p>BYE</p>");

  expectAssertion(function() {
    appendView(view);
  }, /\{\{render\}\} helper once/i);
});

test("{{render}} helper should render templates with models multiple times", function() {
  var template = "<h1>HI</h1> {{render 'post' post1}} {{render 'post' post2}}";
  var post1 = {
    title: "Me first"
  };
  var post2 = {
    title: "Then me"
  };

  var Controller = Ember.Controller.extend({
    container: container,
    post1: post1,
    post2: post2
  });

  var controller = Controller.create();

  view = Ember.View.create({
    controller: controller,
    template: Ember.Handlebars.compile(template)
  });

  var PostController = Ember.ObjectController.extend();
  container.register('controller:post', PostController, {singleton: false});

  Ember.TEMPLATES['post'] = compile("<p>{{title}}</p>");

  appendView(view);

  var postController1 = view.get('_childViews')[0].get('controller');
  var postController2 = view.get('_childViews')[1].get('controller');

  ok(view.$().text().match(/^HI ?Me first ?Then me$/));
  equal(postController1.get('model'), post1);
  equal(postController2.get('model'), post2);

  set(controller, 'post1', { title: "I am new" });

  ok(view.$().text().match(/^HI ?I am new ?Then me$/));
  if (Ember.create.isSimulated) {
    equal(postController1.get('model').title, "I am new");
  } else {
    deepEqual(postController1.get('model'), { title: "I am new" });
  }
});

test("{{render}} helper should not treat invocations with falsy contexts as context-less", function() {
  var template = "<h1>HI</h1> {{render 'post' zero}} {{render 'post' nonexistent}}";

  view = Ember.View.create({
    controller: Ember.Controller.createWithMixins({
      container: container,
      zero: false
    }),
    template: Ember.Handlebars.compile(template)
  });

  var PostController = Ember.ObjectController.extend();
  container.register('controller:post', PostController, {singleton: false});

  Ember.TEMPLATES['post'] = compile("<p>{{#unless content}}NOTHING{{/unless}}</p>");

  appendView(view);

  var postController1 = view.get('_childViews')[0].get('controller');
  var postController2 = view.get('_childViews')[1].get('controller');

  ok(view.$().text().match(/^HI ?NOTHING ?NOTHING$/));
  equal(postController1.get('model'), 0);
  equal(postController2.get('model'), undefined);
});

test("{{render}} helper should render templates both with and without models", function() {
  var template = "<h1>HI</h1> {{render 'post'}} {{render 'post' post}}";
  var post = {
    title: "Rails is omakase"
  };

  var Controller = Ember.Controller.extend({
    container: container,
    post: post
  });

  var controller = Controller.create();

  view = Ember.View.create({
    controller: controller,
    template: Ember.Handlebars.compile(template)
  });

  var PostController = Ember.ObjectController.extend();
  container.register('controller:post', PostController, {singleton: false});

  Ember.TEMPLATES['post'] = compile("<p>Title:{{title}}</p>");

  appendView(view);

  var postController1 = view.get('_childViews')[0].get('controller');
  var postController2 = view.get('_childViews')[1].get('controller');

  ok(view.$().text().match(/^HI ?Title: ?Title:Rails is omakase$/));
  equal(postController1.get('model'), null);
  equal(postController2.get('model'), post);

  set(controller, 'post', { title: "Rails is unagi" });

  ok(view.$().text().match(/^HI ?Title: ?Title:Rails is unagi$/));
  if (Ember.create.isSimulated) {
    equal(postController2.get('model').title, "Rails is unagi");
  } else {
    deepEqual(postController2.get('model'), { title: "Rails is unagi" });
  }
});

test("{{render}} helper should link child controllers to the parent controller", function() {
  var parentTriggered = 0;

  var template = '<h1>HI</h1>{{render "posts"}}';
  var controller = Ember.Controller.extend({
    container: container,
    actions: {
      parentPlease: function() {
        parentTriggered++;
      }
    },
    role: "Mom"
  });

  container.register('controller:posts', Ember.ArrayController.extend());

  view = Ember.View.create({
    controller: controller.create(),
    template: Ember.Handlebars.compile(template)
  });

  Ember.TEMPLATES['posts'] = compile('<button id="parent-action" {{action "parentPlease"}}>Go to {{parentController.role}}</button>');

  appendView(view);

  var button = Ember.$("#parent-action"),
      actionId = button.data('ember-action'),
      action = Ember.Handlebars.ActionHelper.registeredActions[actionId],
      handler = action.handler;

  equal(button.text(), "Go to Mom", "The parentController property is set on the child controller");

  Ember.run(null, handler, new Ember.$.Event("click"));

  equal(parentTriggered, 1, "The event bubbled to the parent");
});

test("{{render}} helper should be able to render a template again when it was removed", function() {
  var template = "<h1>HI</h1>{{outlet}}";
  var controller = Ember.Controller.extend({container: container});
  view = Ember.View.create({
    template: Ember.Handlebars.compile(template)
  });

  Ember.TEMPLATES['home'] = compile("<p>BYE</p>");

  appendView(view);

  Ember.run(function() {
    view.connectOutlet('main', Ember.View.create({
      controller: controller.create(),
      template: compile("<p>1{{render 'home'}}</p>")
    }));
  });

  equal(view.$().text(), 'HI1BYE');

  Ember.run(function() {
    view.connectOutlet('main', Ember.View.create({
      controller: controller.create(),
      template: compile("<p>2{{render 'home'}}</p>")
    }));
  });

  equal(view.$().text(), 'HI2BYE');
});

test("{{render}} works with dot notation", function() {
  var template = '<h1>BLOG</h1>{{render "blog.post"}}';

  var controller = Ember.Controller.extend({container: container});
  container.register('controller:blog.post', Ember.ObjectController.extend());

  view = Ember.View.create({
    controller: controller.create(),
    template: Ember.Handlebars.compile(template)
  });

  Ember.TEMPLATES['blog.post'] = compile("<p>POST</p>");

  appendView(view);

  var renderedView = container.lookup('router:main')._lookupActiveView('blog.post');
  equal(renderedView.get('viewName'), 'blogPost', 'camelizes the view name');
  equal(container.lookup('controller:blog.post'), renderedView.get('controller'), 'rendered with correct controller');
});

test("{{render}} works with slash notation", function() {
  var template = '<h1>BLOG</h1>{{render "blog/post"}}';

  var controller = Ember.Controller.extend({container: container});
  container.register('controller:blog.post', Ember.ObjectController.extend());

  view = Ember.View.create({
    controller: controller.create(),
    template: Ember.Handlebars.compile(template)
  });

  Ember.TEMPLATES['blog.post'] = compile("<p>POST</p>");

  appendView(view);

  var renderedView = container.lookup('router:main')._lookupActiveView('blog.post');
  equal(renderedView.get('viewName'), 'blogPost', 'camelizes the view name');
  equal(container.lookup('controller:blog.post'), renderedView.get('controller'), 'rendered with correct controller');
});

test("Using quoteless templateName works properly (DEPRECATED)", function(){
  var template = '<h1>HI</h1>{{render home}}';
  var controller = Ember.Controller.extend({container: container});
  view = Ember.View.create({
    controller: controller.create(),
    template: Ember.Handlebars.compile(template)
  });

  Ember.TEMPLATES['home'] = compile("<p>BYE</p>");

  expectDeprecation("Using a quoteless parameter with {{render}} is deprecated. Please update to quoted usage '{{render \"home\"}}.");
  appendView(view);

  equal(view.$('p:contains(BYE)').length, 1, "template was rendered");
});

})();

(function() {
var AutoTestLocation, location, supportsHistory, supportsHashChange,
    copy = Ember.copy, get = Ember.get, set = Ember.set,
    run = Ember.run,
    AutoLocation = Ember.AutoLocation,
    getSupportsHistory = AutoLocation._getSupportsHistory,
    getSupportsHashChange = AutoLocation._getSupportsHashChange;

var FakeHistoryLocation = Ember.Object.extend({
  implementation: 'history'
});

var FakeHashLocation = Ember.Object.extend({
  implementation: 'hash'
});

var FakeNoneLocation = Ember.Object.extend({
  implementation: 'none'
});

function createLocation(options) {
  if (!options) { options = {}; }
  location = AutoTestLocation.create(options);
}

module("Ember.AutoLocation", {
  setup: function() {
    supportsHistory = supportsHashChange = null;

    AutoTestLocation = copy(AutoLocation);

    AutoTestLocation._HistoryLocation = FakeHistoryLocation;
    AutoTestLocation._HashLocation = FakeHashLocation;
    AutoTestLocation._NoneLocation = FakeNoneLocation;

    AutoTestLocation._getSupportsHistory = function () {
      if (supportsHistory !== null) {
        return supportsHistory;
      } else {
        return getSupportsHistory.call(this);
      }
    };

    AutoTestLocation._getSupportsHashChange = function () {
      if (supportsHashChange !== null) {
        return supportsHashChange;
      } else {
        return getSupportsHashChange.call(this);
      }
    };

    AutoTestLocation._window = {
      document: {},
      navigator: {
        userAgent: ''
      }
    };

    AutoTestLocation._location = {
      href: 'http://test.com/',
      pathname: '/',
      hash: '',
      search: '',
      replace: function () {
        ok(false, 'location.replace should not be called');
      }
    };

    AutoTestLocation._history = {
      pushState: function () {
        ok(false, 'history.pushState should not be called');
      },
      replaceState: function () {
        ok(false, 'history.replaceState should not be called');
      }
    };
  },

  teardown: function() {
    run(function() {
      if (location && location.destroy) { location.destroy(); }
      location = AutoTestLocation = null;
    });
  }
});

test("_replacePath cannot be used to redirect to a different origin (website)", function() {
  expect(1);

  var expectedURL;

  AutoTestLocation._location = {
    protocol: 'http:',
    hostname: 'emberjs.com',
    port: '1337',

    replace: function (url) {
      equal(url, expectedURL);
    }
  };

  expectedURL = 'http://emberjs.com:1337//google.com';
  AutoTestLocation._replacePath('//google.com');
});

test("AutoLocation.create() should return a HistoryLocation instance when pushStates are supported", function() {
  expect(2);

  supportsHistory = true;

  createLocation();

  equal(get(location, 'implementation'), 'history');
  equal(location instanceof FakeHistoryLocation, true);
});

test("AutoLocation.create() should return a HashLocation instance when pushStates are not supported, but hashchange events are and the URL is already in the HashLocation format", function() {
  expect(2);
  
  supportsHistory = false;
  supportsHashChange = true;

  AutoTestLocation._location.hash = '#/testd';

  createLocation();

  equal(get(location, 'implementation'), 'hash');
  equal(location instanceof FakeHashLocation, true);
});

test("AutoLocation.create() should return a NoneLocation instance when neither history nor hashchange is supported.", function() {
  expect(2);
  
  supportsHistory = false;
  supportsHashChange = false;

  AutoTestLocation._location.hash = '#/testd';

  createLocation();

  equal(get(location, 'implementation'), 'none');
  equal(location instanceof FakeNoneLocation, true);
});

test("AutoLocation.create() should consider an index path (i.e. '/\') without any location.hash as OK for HashLocation", function() {
  expect(2);
  
  supportsHistory = false;
  supportsHashChange = true;

  AutoTestLocation._location = {
    href: 'http://test.com/',
    pathname: '/',
    hash: '',
    search: '',
    replace: function (path) {
      ok(false, 'location.replace should not be called');
    }
  };

  createLocation();

  equal(get(location, 'implementation'), 'hash');
  equal(location instanceof FakeHashLocation, true);
});

test("AutoLocation._getSupportsHistory() should use `history.pushState` existance as proof of support", function() {
  expect(3);
  
  AutoTestLocation._history.pushState = function () {};
  equal(AutoTestLocation._getSupportsHistory(), true, 'Returns true if `history.pushState` exists');
  
  delete AutoTestLocation._history.pushState;
  equal(AutoTestLocation._getSupportsHistory(), false, 'Returns false if `history.pushState` does not exist');

  AutoTestLocation._history = undefined;
  equal(AutoTestLocation._getSupportsHistory(), false, 'Returns false if `history` does not exist');
});

test("AutoLocation.create() should transform the URL for hashchange-only browsers viewing a HistoryLocation-formatted path", function() {
  expect(4);
  
  supportsHistory = false;
  supportsHashChange = true;

  AutoTestLocation._location = {
    hash: '',
    hostname: 'test.com',
    href: 'http://test.com/test',
    pathname: '/test',
    protocol: 'http:',
    port: '',
    search: '',

    replace: function (path) {
      equal(path, 'http://test.com/#/test', 'location.replace should be called with normalized HashLocation path');
    }
  };

  createLocation();

  equal(get(location, 'implementation'), 'none', 'NoneLocation should be returned while we attempt to location.replace()');
  equal(location instanceof FakeNoneLocation, true, 'NoneLocation should be returned while we attempt to location.replace()');
  equal(get(location, 'cancelRouterSetup'), true, 'cancelRouterSetup should be set so the router knows.');
});

test("AutoLocation.create() should transform the URL for pushState-supported browsers viewing a HashLocation-formatted url", function() {
  expect(4);
  
  supportsHistory = true;
  supportsHashChange = true;

  AutoTestLocation._location = {
    hash: '#/test',
    hostname: 'test.com',
    href: 'http://test.com/#/test',
    pathname: '/',
    protocol: 'http:',
    port: '',
    search: '',

    replace: function (path) {
      equal(path, 'http://test.com/test', 'location.replace should be called with normalized HistoryLocation url');
    }
  };

  createLocation();

  equal(get(location, 'implementation'), 'none', 'NoneLocation should be returned while we attempt to location.replace()');
  equal(location instanceof FakeNoneLocation, true, 'NoneLocation should be returned while we attempt to location.replace()');
  equal(get(location, 'cancelRouterSetup'), true, 'cancelRouterSetup should be set so the router knows.');
});

test("AutoLocation._getSupportsHistory() should handle false positive for Android 2.2/2.3, returning false", function() {
  expect(1);
  
  var fakeNavigator = {
    userAgent: 'Mozilla/5.0 (Linux; U; Android 2.3.6; en-us; Nexus S Build/GRK39F) AppleWebKit/533.1 (KHTML, like Gecko) Version/4.0 Mobile Safari/533.1'
  };

  AutoTestLocation._window.navigator = fakeNavigator;

  equal(AutoTestLocation._getSupportsHistory(), false);
});

test("AutoLocation._getSupportsHashChange() should use `onhashchange` event existance as proof of support", function() {
  expect(2);
  
  AutoTestLocation._window.onhashchange = null;
  equal(AutoTestLocation._getSupportsHashChange(), true, 'Returns true if `onhashchange` exists');
  
  AutoTestLocation._window = {
    navigator: window.navigator,
    document: {}
  };

  equal(AutoTestLocation._getSupportsHashChange(), false, 'Returns false if `onhashchange` does not exist');
});

test("AutoLocation._getSupportsHashChange() should handle false positive for IE8 running in IE7 compatibility mode, returning false", function() {
  expect(1);
  
  AutoTestLocation._window = {
    onhashchange: null,
    document: {
      documentMode: 7
    }
  };

  equal(AutoTestLocation._getSupportsHashChange(), false);
});

test("AutoLocation._getPath() should normalize location.pathname, making sure it always returns a leading slash", function() {
  expect(2);
  
  AutoTestLocation._location = { pathname: 'test' };
  equal(AutoTestLocation._getPath(), '/test', 'When there is no leading slash, one is added.');

  AutoTestLocation._location = { pathname: '/test' };
  equal(AutoTestLocation._getPath(), '/test', 'When a leading slash is already there, it isn\'t added again');
});

test("AutoLocation._getHash() should be an alias to Ember.Location._getHash, otherwise it needs its own test!", function() {
  expect(1);
  
  equal(AutoTestLocation._getHash, Ember.Location._getHash);
});

test("AutoLocation._getQuery() should return location.search as-is", function() {
  expect(1);
  
  AutoTestLocation._location = { search: '?foo=bar' };
  equal(AutoTestLocation._getQuery(), '?foo=bar');
});

test("AutoLocation._getFullPath() should return full pathname including query and hash", function() {
  expect(1);
  
  AutoTestLocation._location = {
    href: 'http://test.com/about?foo=bar#foo',
    pathname: '/about',
    search: '?foo=bar',
    hash: '#foo'
  };

  equal(AutoTestLocation._getFullPath(), '/about?foo=bar#foo');
});

test("AutoLocation._getHistoryPath() should return a normalized, HistoryLocation-supported path", function() {
  expect(3);

  AutoTestLocation.rootURL = '/app/';

  AutoTestLocation._location = {
    href: 'http://test.com/app/about?foo=bar#foo',
    pathname: '/app/about',
    search: '?foo=bar',
    hash: '#foo'
  };
  equal(AutoTestLocation._getHistoryPath(), '/app/about?foo=bar#foo', 'URLs already in HistoryLocation form should come out the same');

  AutoTestLocation._location = {
    href: 'http://test.com/app/#/about?foo=bar#foo',
    pathname: '/app/',
    search: '',
    hash: '#/about?foo=bar#foo'
  };
  equal(AutoTestLocation._getHistoryPath(), '/app/about?foo=bar#foo', 'HashLocation formed URLs should be normalized');

  AutoTestLocation._location = {
    href: 'http://test.com/app/#about?foo=bar#foo',
    pathname: '/app/',
    search: '',
    hash: '#about?foo=bar#foo'
  };
  equal(AutoTestLocation._getHistoryPath(), '/app/#about?foo=bar#foo', 'URLs with a hash not following #/ convention shouldn\'t be normalized as a route');
});

test("AutoLocation._getHashPath() should return a normalized, HashLocation-supported path", function() {
  expect(3);

  AutoTestLocation.rootURL = '/app/';

  AutoTestLocation._location = {
    href: 'http://test.com/app/#/about?foo=bar#foo',
    pathname: '/app/',
    search: '',
    hash: '#/about?foo=bar#foo'
  };
  equal(AutoTestLocation._getHashPath(), '/app/#/about?foo=bar#foo', 'URLs already in HistoryLocation form should come out the same');

  AutoTestLocation._location = {
    href: 'http://test.com/app/about?foo=bar#foo',
    pathname: '/app/about',
    search: '?foo=bar',
    hash: '#foo'
  };
  equal(AutoTestLocation._getHashPath(), '/app/#/about?foo=bar#foo', 'HistoryLocation formed URLs should be normalized');

  AutoTestLocation._location = {
    href: 'http://test.com/app/#about?foo=bar#foo',
    pathname: '/app/',
    search: '',
    hash: '#about?foo=bar#foo'
  };

  equal(AutoTestLocation._getHashPath(), '/app/#/#about?foo=bar#foo', 'URLs with a hash not following #/ convention shouldn\'t be normalized as a route');
});

test("AutoLocation.create requires any rootURL given to end in a trailing forward slash", function() {
  expect(3);

  var expectedMsg = /rootURL must end with a trailing forward slash e.g. "\/app\/"/;

  expectAssertion(function() {
    createLocation({ rootURL: 'app' });
  }, expectedMsg);

  expectAssertion(function() {
    createLocation({ rootURL: '/app' });
  }, expectedMsg);

  expectAssertion(function() {
    // Note the trailing whitespace
    createLocation({ rootURL: '/app/ ' });
  }, expectedMsg);
});
})();

(function() {
var FakeHistory, HistoryTestLocation, location,
    get = Ember.get,
    set = Ember.set,
    rootURL = window.location.pathname;

function createLocation(options){
  if(!options) { options = {}; }
  location = HistoryTestLocation.create(options);
}

module("Ember.HistoryLocation", {
  setup: function() {
    FakeHistory = {
      state: null,
      _states: [],
      replaceState: function(state, title, url){
        this.state = state;
        this._states[0] = state;
      },
      pushState: function(state, title, url){
        this.state = state;
        this._states.unshift(state);
      }
    };

    HistoryTestLocation = Ember.HistoryLocation.extend({
      history: FakeHistory
    });
  },

  teardown: function() {
    Ember.run(function() {
      if (location) { location.destroy(); }
    });
  }
});

test("HistoryLocation initState does not get fired on init", function() {
  expect(1);

  HistoryTestLocation.reopen({
    init: function(){
      ok(true, 'init was called');
      this._super();
    },
    initState: function() {
      ok(false, 'initState() should not be called automatically');
    }
  });

  createLocation();
});

test("webkit doesn't fire popstate on page load", function() {
  expect(1);

  HistoryTestLocation.reopen({
    initState: function() {
      this._super();
      // these two should be equal to be able
      // to successfully detect webkit initial popstate
      equal(this._previousURL, this.getURL());
    }
  });

  createLocation();
  location.initState();
});

test("base URL is removed when retrieving the current pathname", function() {
    expect(1);

    HistoryTestLocation.reopen({
        init: function() {
            this._super();

            set(this, 'location', { pathname: '/base/foo/bar' });
            set(this, 'baseURL', '/base/');
        },

        initState: function() {
            this._super();

            equal(this.getURL(), '/foo/bar');
        }
    });

    createLocation();
    location.initState();
});

test("base URL is preserved when moving around", function() {
    expect(1);

    HistoryTestLocation.reopen({
        init: function() {
            this._super();

            set(this, 'location', { pathname: '/base/foo/bar' });
            set(this, 'baseURL', '/base/');
        }
    });

    createLocation();
    location.initState();
    location.setURL('/one/two');

    equal(FakeHistory.state.path, '/base/one/two');
});

test("setURL continues to set even with a null state (iframes may set this)", function() {
    expect(1);

    createLocation();
    location.initState();

    FakeHistory.pushState(null);
    location.setURL('/three/four');

    equal(FakeHistory.state && FakeHistory.state.path, '/three/four');
});

test("replaceURL continues to set even with a null state (iframes may set this)", function() {
    expect(1);

    createLocation();
    location.initState();

    FakeHistory.pushState(null);
    location.replaceURL('/three/four');

    equal(FakeHistory.state && FakeHistory.state.path, '/three/four');
});

test("HistoryLocation.getURL() returns the current url, excluding both rootURL and baseURL", function() {
    expect(1);

    HistoryTestLocation.reopen({
        init: function() {
            this._super();

            set(this, 'location', { pathname: '/base/foo/bar' });
            set(this, 'rootURL', '/app/');
            set(this, 'baseURL', '/base/');
        }
    });

    createLocation();

    equal(location.getURL(), '/foo/bar');
});
})();

(function() {
var buildContainer = function(namespace) {
  var container = new Ember.Container();

  container.set = Ember.set;
  container.resolver = resolverFor(namespace);
  container.optionsForType('view', { singleton: false });

  container.register('application:main', namespace, { instantiate: false });

  container.register('controller:basic', Ember.Controller, { instantiate: false });
  container.register('controller:object', Ember.ObjectController, { instantiate: false });
  container.register('controller:array', Ember.ArrayController, { instantiate: false });

  return container;
};

function resolverFor(namespace) {
  return function(fullName) {
    var nameParts = fullName.split(":"),
        type = nameParts[0], name = nameParts[1];

    if (name === 'basic') {
      name = '';
    }
    var className = Ember.String.classify(name) + Ember.String.classify(type);
    var factory = Ember.get(namespace, className);



    if (factory) { return factory; }
  };
}

var container, appController, namespace;

module("Ember.controllerFor", {
  setup: function() {
    namespace = Ember.Namespace.create();
    container = buildContainer(namespace);
    container.register('controller:app', Ember.Controller.extend());
    appController = container.lookup('controller:app');
  },
  teardown: function() {
    Ember.run(function () {
      container.destroy();
      namespace.destroy();
    });
  }
});

test("controllerFor should lookup for registered controllers", function() {
  var controller = Ember.controllerFor(container, 'app');

  equal(appController, controller, 'should find app controller');
});

module("Ember.generateController", {
  setup: function() {
    namespace = Ember.Namespace.create();
    container = buildContainer(namespace);
  },
  teardown: function() {
    Ember.run(function () {
      container.destroy();
      namespace.destroy();
    });
  }
});

test("generateController should create Ember.Controller", function() {
  var controller = Ember.generateController(container, 'home');

  ok(controller instanceof Ember.Controller, 'should create controller');
});

test("generateController should create Ember.ObjectController", function() {
  var context = {};
  var controller = Ember.generateController(container, 'home', context);

  ok(controller instanceof Ember.ObjectController, 'should create controller');
});

test("generateController should create Ember.ArrayController", function() {
  var context = Ember.A();
  var controller = Ember.generateController(container, 'home', context);

  ok(controller instanceof Ember.ArrayController, 'should create controller');
});

test("generateController should create App.Controller if provided", function() {
  var controller;
  namespace.Controller = Ember.Controller.extend();

  controller = Ember.generateController(container, 'home');

  ok(controller instanceof namespace.Controller, 'should create controller');
});

test("generateController should create App.ObjectController if provided", function() {
  var context = {}, controller;
  namespace.ObjectController = Ember.ObjectController.extend();

  controller = Ember.generateController(container, 'home', context);

  ok(controller instanceof namespace.ObjectController, 'should create controller');

});

test("generateController should create App.ArrayController if provided", function() {
  var context = Ember.A(), controller;
  namespace.ArrayController = Ember.ArrayController.extend();

  controller = Ember.generateController(container, 'home', context);

  ok(controller instanceof namespace.ArrayController, 'should create controller');

});

})();

(function() {
var route, routeOne, routeTwo, router, container, lookupHash;

function createRoute(){
  route = Ember.Route.create();
}

function cleanupRoute(){
  Ember.run(route, 'destroy');
}

module("Ember.Route", {
  setup: createRoute,
  teardown: cleanupRoute
});

test("default store utilizes the container to acquire the model factory", function() {
  var Post, post;

  expect(4);

  post = {};

  Post = Ember.Object.extend();
  Post.reopenClass({
    find: function(id) {
      return post;
    }
  });

  container = {
    has: function() { return true; },
    lookupFactory: lookupFactory
  };

  route.container = container;

  equal(route.model({ post_id: 1}), post);
  equal(route.findModel('post', 1), post, '#findModel returns the correct post');

  function lookupFactory(fullName) {
    equal(fullName, "model:post", "correct factory was looked up");

    return Post;
  }

});

test("'store' can be injected by data persistence frameworks", function() {
  expect(8);
  Ember.run(route, 'destroy'); 

  var container = new Ember.Container();
  var post = {
    id: 1
  };

  var Store = Ember.Object.extend({
    find: function(type, value){
      ok(true, 'injected model was called');
      equal(type, 'post', 'correct type was called');
      equal(value, 1, 'correct value was called');
      return post;
    }
  });

  container.register('route:index',  Ember.Route);
  container.register('store:main', Store);

  container.injection('route', 'store', 'store:main');

  route = container.lookup('route:index');

  equal(route.model({ post_id: 1}), post, '#model returns the correct post');
  equal(route.findModel('post', 1), post, '#findModel returns the correct post');
});

test("assert if 'store.find' method is not found", function() {
  expect(1);
  Ember.run(route, 'destroy');

  var container = new Ember.Container();
  var Post = Ember.Object.extend();

  container.register('route:index', Ember.Route);
  container.register('model:post',  Post);

  route = container.lookup('route:index');

  expectAssertion(function() {
    route.findModel('post', 1);
  }, 'Post has no method `find`.');
});

test("asserts if model class is not found", function() {
  expect(1);
  Ember.run(route, 'destroy');

  var container = new Ember.Container();
  container.register('route:index',  Ember.Route);

  route = container.lookup('route:index');

  expectAssertion(function() {
    route.model({ post_id: 1});
  }, "You used the dynamic segment post_id in your route undefined, but undefined.Post did not exist and you did not override your route's `model` hook.");
});

test("'store' does not need to be injected", function() {
  expect(1);

  Ember.run(route, 'destroy');
  var originalAssert = Ember.assert;

  var container = new Ember.Container();
  container.register('route:index',  Ember.Route);

  route = container.lookup('route:index');

  ignoreAssertion(function(){
    route.model({ post_id: 1});
  });

  ok(true, 'no error was raised');
});

module("Ember.Route serialize", {
  setup: createRoute,
  teardown: cleanupRoute
});

test("returns the models properties if params does not include *_id", function(){
  var model = {id: 2, firstName: 'Ned', lastName: 'Ryerson'};

  deepEqual(route.serialize(model, ['firstName', 'lastName']), {firstName: 'Ned', lastName: 'Ryerson'}, "serialized correctly");
});

test("returns model.id if params include *_id", function(){
  var model = {id: 2};

  deepEqual(route.serialize(model, ['post_id']), {post_id: 2}, "serialized correctly");
});

test("returns undefined if model is not set", function(){
  equal(route.serialize(undefined, ['post_id']), undefined, "serialized correctly");
});

module("Ember.Route interaction", {
  setup: function() {
    container = {
      lookup: function(fullName) {
        return lookupHash[fullName];
      }
    };

    routeOne = Ember.Route.create({ container: container, routeName: 'one' });
    routeTwo = Ember.Route.create({ container: container, routeName: 'two' });

    lookupHash = {
      'route:one': routeOne,
      'route:two': routeTwo
    };
  },

  teardown: function() {
    Ember.run(function() {
      routeOne.destroy();
      routeTwo.destroy();
    });
  }
});

test("controllerFor uses route's controllerName if specified", function() {
  var testController = {};
  lookupHash['controller:test'] = testController;

  routeOne.controllerName = 'test';

  equal(routeTwo.controllerFor('one'), testController);
});
})();

(function() {
var map = Ember.EnumerableUtils.map,
    copy = Ember.copy,
    run = Ember.run,
    merge = Ember.merge,
    Container = Ember.Container,
    EmberRouter = Ember.Router,
    HashLocation = Ember.HashLocation,
    AutoLocation = Ember.AutoLocation;

var container, Router, router;

function createRouter(overrides) {
  var opts = merge({ container: container }, overrides);
  router = Router.create(opts);
}

module("Ember Router", {
  setup: function() {
    container = new Ember.Container();

    // register the HashLocation (the default)
    container.register('location:hash', HashLocation);

    // ensure rootURL is injected into any locations
    container.injection('location', 'rootURL', '-location-setting:root-url');

    Router = EmberRouter.extend();
  },
  teardown: function() {
    container = Router = router = null;
  }
});

test("should create a router if one does not exist on the constructor", function() {
  createRouter();

  ok(router.router);
});

test("should destroy its location upon destroying the routers container.", function() {
  createRouter();

  var location = router.get('location');

  Ember.run(container, 'destroy');

  ok(location.isDestroyed, "location should be destroyed");
});

test("should instantiate its location with its `rootURL`", function() {
  createRouter({
    rootURL: '/rootdir/'
  });

  var location = router.get('location');

  equal(location.get('rootURL'), '/rootdir/');
});

test("Ember.AutoLocation._replacePath should be called with the right path", function() {
  expect(1);

  var AutoTestLocation = copy(AutoLocation);

  AutoTestLocation._location = {
    href: 'http://test.com/rootdir/welcome',
    origin: 'http://test.com',
    pathname: '/rootdir/welcome',
    hash: '',
    search: '',
    replace: function(url) {
      equal(url, 'http://test.com/rootdir/#/welcome');
    }
  };
  AutoTestLocation._getSupportsHistory = function() { return false; };

  container.register('location:auto', AutoTestLocation);

  createRouter({
    location: 'auto',
    rootURL: '/rootdir/'
  });
});

test("Ember.Router._routePath should consume identical prefixes", function() {
  createRouter();

  expect(8);

  function routePath(s1, s2, s3) {
    var handlerInfos = map(arguments, function(s) {
      return { name: s };
    });
    handlerInfos.unshift({ name: 'ignored' });

    return Ember.Router._routePath(handlerInfos);
  }

  equal(routePath('foo'), 'foo');
  equal(routePath('foo', 'bar', 'baz'), 'foo.bar.baz');
  equal(routePath('foo', 'foo.bar'), 'foo.bar');
  equal(routePath('foo', 'foo.bar', 'foo.bar.baz'), 'foo.bar.baz');
  equal(routePath('foo', 'foo.bar', 'foo.bar.baz.wow'), 'foo.bar.baz.wow');
  equal(routePath('foo', 'foo.bar.baz.wow'), 'foo.bar.baz.wow');
  equal(routePath('foo.bar', 'bar.baz.wow'), 'foo.bar.baz.wow');

  // This makes no sense, not trying to handle it, just
  // making sure it doesn't go boom.
  equal(routePath('foo.bar.baz', 'foo'), 'foo.bar.baz.foo');
});

test("Router should cancel routing setup when the Location class says so via cancelRouterSetup", function() {
  expect(0);

  var FakeLocation = {
    cancelRouterSetup: true,
    create: function () { return this; }
  };

  container.register('location:fake', FakeLocation);

  router = Router.create({
    container: container,
    location: 'fake',

    _setupRouter: function () {
      ok(false, '_setupRouter should not be called');
    }
  });

  router.startRouting();
});

test("AutoLocation should replace the url when it's not in the preferred format", function() {
  expect(1);

  var AutoTestLocation = copy(AutoLocation);

  AutoTestLocation._location = {
    href: 'http://test.com/rootdir/welcome',
    origin: 'http://test.com',
    pathname: '/rootdir/welcome',
    hash: '',
    search: '',
    replace: function(url) {
      equal(url, 'http://test.com/rootdir/#/welcome');
    }
  };

  AutoTestLocation._getSupportsHistory = function() { return false; };

  container.register('location:auto', AutoTestLocation);

  createRouter({
    location: 'auto',
    rootURL: '/rootdir/'
  });
});
})();

