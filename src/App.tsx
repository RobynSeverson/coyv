import { BrowserRouter, Route, Routes } from 'react-router-dom'
import SiteLayout from './components/SiteLayout'
import Landing from './pages/Landing'
import Home from './pages/Home'
import Collection from './pages/Collection'

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Landing />} />
        <Route element={<SiteLayout />}>
          <Route path="/home" element={<Home />} />
          <Route
            path="/prints"
            element={
              <Collection title="prints" blurb="Editions on paper" />
            }
          />
          <Route
            path="/memories"
            element={
              <Collection title="memories" blurb="Everything else, kept" />
            }
          />
        </Route>
      </Routes>
    </BrowserRouter>
  )
}
