import { BrowserRouter, Route, Routes } from 'react-router-dom'
import Home from './pages/Home'
import Beyond from './pages/Beyond'

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/beyond" element={<Beyond />} />
      </Routes>
    </BrowserRouter>
  )
}
