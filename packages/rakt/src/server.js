import React from 'react'
import express from 'express'
// import path from 'path'
import parseModules from './parseModules'
import parseRoutes from './parseRoutes'
import webpack from 'webpack'
import 'isomorphic-fetch'

import favicon from 'serve-favicon'

import { StaticRouter, matchPath } from 'react-router-dom'
import { layout } from './layout'
import { Rakt } from './'
import devware from 'webpack-dev-middleware'
// import hotware from 'webpack-hot-middleware'
// import historyApiFallback from 'connect-history-api-fallback'


// let oldRender = Route.render 

// // when you're not applying babel plugin on server files 
// Route.render = (props) => {
//   let { module, match, absolute } = props
//   console.log({absolute})
//   if(module && match){
    
//     let Module = require(absolute)
//     console.log('sadasdasd')
//     return oldRender({...props, match, Module})
//   }
//   return oldRender(props)
// }



export default function server({ entry }){

  let App = require(entry)
  App = App.default || App

  
  let modules = parseModules(entry)
  let routes = parseRoutes(entry)
  let compiler = webpack({ 
    devtool: "source-map",
    entry: [entry, require.resolve('./client.js')],
    output: {
      path: __dirname, // todo - ?
      filename: "[name].bundle.js",
      chunkFilename: "[name].chunk.js"
    },  
    module: {
      rules: [
        {
          test: /\.js$/,
          exclude: /node_modules/,
          loader: "babel-loader",
          query: {
            "presets": [ "es2015", "stage-0", "react" ],
            "plugins": [ require.resolve("./babel.js"), require.resolve("./babel2.js"), "transform-decorators-legacy" ]
          }  
        }
      ]    
    },
    plugins: [
      new webpack.DefinePlugin({
        $ENTRY: JSON.stringify(entry),
        $ROUTES: JSON.stringify(routes.map(({module, ...rest}) => rest))
      })
    ]
  })
  // webpack dev server 

  const app = express()

  // app.use(historyApiFallback({ verbose: false }));
  app.use(devware(compiler, {
    lazy: true
    // noInfo: true,
  }))

  // app.use(hotware(compiler));

  app.use(favicon('./favicon.png'));

  app.use('/api/:mod/*', (req, res, next ) => {
    // todo - feed the matches that got here, since the url isn't reliable 
    let mod = require(modules[req.params.mod])
    mod = (mod.default ? mod.default : mod)
    if(mod.mod){
      // todo - deep?
      let called = false, done = (err, data) => {
        called = true
        err ? next(err) : res.send(data)
      }
      let returned = mod.mod({
        req, res, next, 
        done
      })
      if(returned && returned.then){
        // promise-like!
        // todo - make sure `done()`` wasn't called
        returned.then(x => !called && res.send(x), x => !called && next(x))
      }
    }
    else {
      next(404)
    }          
  })

  function getFetcher(x){
    let m = require(x.module)
    m = m.default || m 
    return m.mod 
  }

  app.get('*', (req, res, next) => {
    // how to ignore
    // fetch data 

    let matches = routes.filter(({ path, exact, strict, defer }) => 
      !defer && matchPath(req.url, path, { exact, strict }))  

    let deferred = routes.filter(({ path, exact, strict, defer }) => 
      defer && matchPath(req.url, path, { exact, strict }))

    

    let fetchers = matches    
      .filter(x => !!getFetcher(x))

    function andThen(err, data){
      
      let cache = {}
      data.forEach(x => {
        cache[`${x.hash}:${req.url}`] = x.result
      })

      let context = {}

      layout(<StaticRouter location={req.url} context={context}>
        <Rakt cache={cache}>
            <App />
        </Rakt>        
      </StaticRouter>, {
        scripts: [ 'main.bundle.js', ...matches.map(x => `${x.hash}.chunk.js`)],
        stylesheets: [],
        deferred: deferred.map(x => ({ script: `${x.hash}.chunk.js`, data: getFetcher(x) ? `/api/${x.hash}${req.url}`: false })),
        hydrate: cache
      }).toStream().pipe(res)
    }

    let promises = fetchers    
      .map(x => {
        return fetch(`http://localhost:3000/api/${x.hash}${req.url}`)
          .then(x => x.json())
      })

    Promise.all(promises).then(results => 
      andThen(undefined, matches.map((x, i) => 
        ({...x, result: results[i]}))), 
      andThen)    
    
  })
  return app
  // todo - when do we 404?
}
