import { lazy, Suspense } from 'react'
import { BrowserRouter, Routes, Route } from 'react-router-dom'
import HomePage from './pages/HomePage'
import LoginPage from './pages/LoginPage'

// 懒加载（首屏不加载；react-pdf 重页面进入时才拉 pdf chunk）
const RegisterPage       = lazy(() => import('./pages/RegisterPage'))
const ForgotPasswordPage = lazy(() => import('./pages/ForgotPasswordPage'))
const DiscardedPage      = lazy(() => import('./pages/DiscardedPage'))
const ReadingPage        = lazy(() => import('./pages/ReadingPage'))
const RecitationPage     = lazy(() => import('./pages/RecitationPage'))
const ResultPage         = lazy(() => import('./pages/ResultPage'))
const HistoryPage        = lazy(() => import('./pages/HistoryPage'))
const ParentPage         = lazy(() => import('./pages/ParentPage'))
const GamePage           = lazy(() => import('./pages/GamePage'))
const MicTest            = lazy(() => import('./pages/MicTest'))
const PdfTest            = lazy(() => import('./pages/PdfTest'))

function PageLoading() {
  return (
    <div className="flex items-center justify-center min-h-screen bg-cream">
      <p className="text-brown-mute text-sm animate-pulse">加载中…</p>
    </div>
  )
}

export default function App() {
  return (
    <BrowserRouter>
      <Suspense fallback={<PageLoading />}>
        <Routes>
          <Route path="/" element={<HomePage />} />
          <Route path="/login" element={<LoginPage />} />
          <Route path="/register" element={<RegisterPage />} />
          <Route path="/forgot-password" element={<ForgotPasswordPage />} />
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
      </Suspense>
    </BrowserRouter>
  )
}
