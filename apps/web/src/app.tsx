import { Route, Router, Switch } from 'wouter'
import { useHashLocation } from 'wouter/use-hash-location'
import { DrillScreen } from './screens/drill'
import { ExploreScreen } from './screens/explore'
import { GenerationScreen } from './screens/generation'
import { HomeScreen } from './screens/home'
import { NewRepertoireScreen } from './screens/new-repertoire'
import { StatsScreen } from './screens/stats'
import { Layout } from './ui/layout'

export function App() {
  return (
    <Router hook={useHashLocation}>
      <Layout>
        <Switch>
          <Route path="/" component={HomeScreen} />
          <Route path="/new" component={NewRepertoireScreen} />
          <Route path="/r/:id/generation" component={GenerationScreen} />
          <Route path="/r/:id/explore/:moves?" component={ExploreScreen} />
          <Route path="/r/:id/drill/:moves?" component={DrillScreen} />
          <Route path="/r/:id/stats" component={StatsScreen} />
          <Route>
            <p>Page introuvable.</p>
          </Route>
        </Switch>
      </Layout>
    </Router>
  )
}
