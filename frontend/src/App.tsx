import { BrowserRouter, Routes, Route } from 'react-router-dom'
import HomePage from './pages/HomePage'
import LoginPage from './pages/LoginPage'
import MicTest from './pages/MicTest'
import PdfTest from './pages/PdfTest'
import ReadingPage from './pages/ReadingPage'
import RecitationPage from './pages/RecitationPage'
import ResultPage from './pages/ResultPage'
import ParentPage from './pages/ParentPage'
import HistoryPage from './pages/HistoryPage'
import GamePage from './pages/GamePage'
import DiscardedPage from './pages/DiscardedPage'

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<HomePage />} />
        <Route path="/login" element={<LoginPage />} />
        <Route path="/discarded" element={<DiscardedPage />} />
        <Route path="/reading/:childId" element={<ReadingPage />} />
        <Route path="/recitation/:childId" element={<RecitationPage />} />
        <Route path="/result/:sessionId" element={<ResultPage />} />
        <Route path="/history/:childId" element={<HistoryPage />} />
        <Route path="/parent" element={<ParentPage />} />
        <Route path="/game/:gameId" element={<GamePage />} />
        <Route path="/mic-test" element={<MicTest />} />
        <Route path="/pdf-test" element={<PdfTest />} />
      </Routes>
    </BrowserRouter>
  )
}
