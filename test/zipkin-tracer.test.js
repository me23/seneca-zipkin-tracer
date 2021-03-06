'use strict'

const Lab = require('lab')
const Code = require('code')
const FakeHttp = require('./fake-server')

const Plugin = require('./..')
const Seneca = require('seneca')

const lab = exports.lab = Lab.script()
const describe = lab.describe
const it = lab.it
const expect = Code.expect


const FAKE_SERVER_PORT = 9090

function pick_trace_id (obj) {
  return obj.traceId
}

function pick_span_id (obj) {
  return obj.id
}

function pick_parent_id (obj) {
  return obj.parentId
}

function pick_annotations (obj) {
  return obj.annotations[0]
}

function pick_name (obj) {
  return obj.name
}

function only_root (obj) {
  return !obj.parentId
}

function only_child (obj) {
  return !!obj.parentId
}

function getClientwithInjector(func){
	return Seneca({
		tag: 'client'
	  })
		.test('print')
		.use(Plugin, {
		  sampling: 1,
		  transport: 'http-simple',
		  port: FAKE_SERVER_PORT,
		  exposeInjectTracerData: func
		})
		.add('with_child:1', function (args, done) {
		  this.act('remote_standard:1', done)
		})
		.add('local:1', function (args, done) {
		  done(null, {hello: 'local'})
		})
		.client({
		  pin: 'remote_standard:1'
		})
}

describe('Seneca Zipkin Tracer', function () {
  let fakeHttp
  let client
  let server

  lab.beforeEach(function setup_client (done) {
    client = Seneca({
      tag: 'client'
    })
      .test('print')
      .use(Plugin, {
        sampling: 1,
        transport: 'http-simple',
        port: FAKE_SERVER_PORT
      })
      .add('with_child:1', function (args, done) {
        this.act('remote_standard:1', done)
      })
      .add('local:1', function (args, done) {
        done(null, {hello: 'local'})
      })
      .client({
        pin: 'remote_standard:1'
      })
	  .ready(done)
  })

  lab.beforeEach(function setup_server (done) {
    server = Seneca({
      log: 'silent',
      tag: 'server'
    })
    .use(Plugin, {
      sampling: 1,
      transport: 'http-simple',
      port: FAKE_SERVER_PORT
    })
    .add('remote_standard:1', function (args, done) {
      done(null, {hello: 'world'})
    })
    .listen({
      pin: 'remote_standard:1'
    })
	.ready(done)
  })

  lab.before(function (done) {
    fakeHttp = FakeHttp(FAKE_SERVER_PORT, done)
  })

  lab.beforeEach(function (done) {
    fakeHttp.reset()
    done()
  })

  lab.after(function (done) {
    fakeHttp.stop()
    done()
  })

  lab.afterEach(function (done) {
	client.close(done)
  })

  lab.afterEach(function (done) {
	server.close(done);
  })

  describe('Standard trace', function () {
    it('should send the four basic annotations', function (done) {
      let requests = []

      fakeHttp.on('request', function (data) {
        requests = requests.concat(data.body)
        if (requests.length >= 4) {
          check_conditions()
        }
      })

      function check_conditions () {
        try {
          expect(requests).to.have.length(4)

          const trace_id = requests[0].traceId
          const span_id = requests[0].id
          const parent_id = requests[0].parentId

          expect(requests.map(pick_name)).to.only.contain('remote_standard:1')
          expect(requests.map(pick_trace_id)).to.only.contain(trace_id)
          expect(requests.map(pick_span_id)).to.only.contain(span_id)
          expect(requests.map(pick_parent_id)).to.only.contain(parent_id)

          expect(requests.map(pick_annotations).map(function(item) {
            return {value: item.value,
                    endpoint: {serviceName: item.endpoint.serviceName}}
          })).to.contain([{
            value: 'cs',
            endpoint: {serviceName: 'client'}
          }, {
            value: 'cr',
            endpoint: {serviceName: 'client'}
          }, {
            value: 'sr',
            endpoint: {serviceName: 'server'}
          }, {
            value: 'ss',
            endpoint: {serviceName: 'server'}
          }])

        }
        catch (ex) {
          return done(ex)
        }
		6
        done()
      }

      client.act('remote_standard:1', function () {})
    })
  })

  describe('Local trace', function () {
    it('should send the client annotations only', function (done) {
      let requests = []

      fakeHttp.on('request', function (data) {
        requests = requests.concat(data.body)
        if (requests.length >= 2) {
          check_conditions()
        }
      })

      function check_conditions () {
        try {
          expect(requests).to.have.length(2)

          const trace_id = requests[0].traceId
          const span_id = requests[0].id
          const parent_id = requests[0].parentId
          const annotations = requests.map(pick_annotations)

          expect(requests.map(pick_name)).to.only.contain('local:1')
          expect(requests.map(pick_trace_id)).to.only.contain(trace_id)
          expect(requests.map(pick_span_id)).to.only.contain(span_id)
          expect(requests.map(pick_parent_id)).to.only.contain(parent_id)

          expect(annotations).to.have.length(2)

          expect(annotations.map(function(item) {
            return {value: item.value,
                    endpoint: {serviceName: item.endpoint.serviceName}}
          })).to.include([{
            value: 'cs',
            endpoint: {serviceName: 'client'}
          }, {
            value: 'cr',
            endpoint: {serviceName: 'client'}
          }])
        }
        catch (ex) {
          return done(ex)
        }

        done()
      }

      client.act('local:1', function () {})
    })
  })

  describe('Child trace', function () {
    it('should send annotations for both root and child span', function (done) {
      let requests = []

      fakeHttp.on('request', function (data) {
        requests = requests.concat(data.body)
        if (requests.length >= 6) {
          check_conditions()
        }
      })

      function check_conditions () {
        try {
          expect(requests).to.have.length(6)

          let roots = requests.filter(only_root)
          let children = requests.filter(only_child)

		  expect(requests.map(pick_name)).to.only.contain(['remote_standard:1', 'with_child:1'])

		  // roots

          const root_trace_id = roots[0].traceId
          const root_span_id = roots[0].id
          const root_parent_id = undefined
          const root_annotations = roots.map(pick_annotations)

          expect(roots.map(pick_trace_id)).to.only.contain(root_trace_id)
          expect(roots.map(pick_span_id)).to.only.contain(root_span_id)
          expect(roots.map(pick_parent_id)).to.only.contain(root_parent_id)

          expect(root_annotations).to.have.length(2)
          //expect(root_annotations).to.include([{


          expect(root_annotations.map(function(item) {
            return {value: item.value,
                    endpoint: {serviceName: item.endpoint.serviceName}}
          })).to.include([{

            value: 'cs',
            endpoint: {serviceName: 'client'}
          }, {
            value: 'cr',
            endpoint: {serviceName: 'client'}
          }])

          // children

          const child_span_id = children[0].id
          const child_annotations = children.map(pick_annotations)

          expect(children.map(pick_span_id)).to.only.contain(child_span_id)
          expect(children.map(pick_trace_id)).to.only.contain(root_trace_id)
          expect(children.map(pick_parent_id)).to.only.contain(root_span_id)

          expect(child_annotations).to.have.length(4)
          //expect(child_annotations).to.include([{


          expect(child_annotations.map(function(item) {
            return {value: item.value,
                    endpoint: {serviceName: item.endpoint.serviceName}}
          })).to.include([{

            value: 'cs',
            endpoint: {serviceName: 'client'}
          }, {
            value: 'cr',
            endpoint: {serviceName: 'client'}
          }, {
            value: 'sr',
            endpoint: {serviceName: 'server'}
          }, {
            value: 'ss',
            endpoint: {serviceName: 'server'}
          }])
        }
        catch (ex) {
          return done(ex)
        }

        done()
      }

      client.act('with_child:1', function () {})
	})
	
	it('should send annotations for both root and child span with only one parentId', function (done) {
      let requests = []

      fakeHttp.on('request', function (data) {
        requests = requests.concat(data.body)
        if (requests.length >= 12) {
          check_conditions()
        }
      })

      function check_conditions () {
        try {
          expect(requests).to.have.length(12)

          let roots = requests.filter(only_root)
		  let children = requests.filter(only_child)

		  expect(requests.map(pick_name)).to.only.contain(['remote_standard:1', 'with_child:1'])

          // roots

          const root_trace_id = roots[0].traceId
          const root_span_id = roots[0].id
          const root_parent_id = undefined
          const root_annotations = roots.map(pick_annotations)

          expect(roots.map(pick_trace_id)).to.only.contain([root_trace_id, roots[1].traceId])
          expect(roots.map(pick_span_id)).to.only.contain([root_span_id, roots[1].id])
          expect(roots.map(pick_parent_id)).to.only.contain(root_parent_id)

          expect(root_annotations).to.have.length(4)
          //expect(root_annotations).to.include([{


          expect(root_annotations.map(function(item) {
            return {value: item.value,
                    endpoint: {serviceName: item.endpoint.serviceName}}
          })).to.include([{

            value: 'cs',
            endpoint: {serviceName: 'client'}
          }, {
            value: 'cr',
            endpoint: {serviceName: 'client'}
          }])

          // children

          const child_span_id = children[0].id
		  const child_annotations = children.map(pick_annotations)
		  
          expect(children.map(pick_span_id)).to.only.contain([child_span_id, children[1].id])
          expect(children.map(pick_trace_id)).to.only.contain([root_trace_id, roots[1].traceId])
          expect(children.map(pick_parent_id)).to.only.contain([root_span_id, roots[1].id])

          expect(child_annotations).to.have.length(8)
          //expect(child_annotations).to.include([{


          expect(child_annotations.map(function(item) {
            return {value: item.value,
                    endpoint: {serviceName: item.endpoint.serviceName}}
          })).to.include([{

            value: 'cs',
            endpoint: {serviceName: 'client'}
          }, {
            value: 'cr',
            endpoint: {serviceName: 'client'}
          }, {
            value: 'sr',
            endpoint: {serviceName: 'server'}
          }, {
            value: 'ss',
            endpoint: {serviceName: 'server'}
          }])
        }
        catch (ex) {
          return done(ex)
        }

        done()
      }

	  client.act('with_child:1', function () {})
	  client.act('with_child:1', function () {})
    })
  })


  describe('Inject Parent Trace', function () {
    it('should send annotations for only childs span', function (done) {
      let requests = []

      fakeHttp.on('request', function (data) {
		requests = requests.concat(data.body)
        if (requests.length >= 4) {
          check_conditions()
        }
      })

      function check_conditions () {
		try {
			expect(requests).to.have.length(4)

			const roots =  requests.filter(only_root);

			expect(roots).to.equal([]);
  
			const trace_id = requests[0].traceId
			const span_id = requests[0].id
			const parent_id = requests[0].parentId

			expect(parent_id).to.equal('abc55accf795b003');

			expect(requests.map(pick_name)).to.only.contain('remote_standard:1')
			expect(requests.map(pick_trace_id)).to.only.contain(trace_id)
			expect(requests.map(pick_span_id)).to.only.contain(span_id)
			expect(requests.map(pick_parent_id)).to.only.contain(parent_id)

			expect(requests.map(pick_annotations).map(function(item) {
				return {value: item.value,
						endpoint: {serviceName: item.endpoint.serviceName}}
			})).to.contain([{
				value: 'cs',
				endpoint: {serviceName: 'client'}
			}, {
				value: 'cr',
				endpoint: {serviceName: 'client'}
			}, {
				value: 'sr',
				endpoint: {serviceName: 'server'}
			}, {
				value: 'ss',
				endpoint: {serviceName: 'server'}
			}])
		  }
		  catch (ex) {
			return done(ex)
		  }
  
		  done()
	  }
	  
	  let parentTrace= {
		"traceId":"8e555accf795b009",
		"spanId":"abc55accf795b003",
		"parentSpanId":'' 
	  };	  

	  let exposedFunction;

	  let exposer = function(func){
		  exposedFunction = func;
	  }
	  
	  client = getClientwithInjector(exposer)
	  .ready(()=>{
		expect(exposedFunction).to.be.a.function();
		exposedFunction(parentTrace);

		client.act('remote_standard:1', function () {})
	  });
	})
  })
})
