import { Link, Route, Routes, useLocation } from 'react-router-dom';
import CreatePage from './pages/CreatePage';
import DropPage from './pages/DropPage';
import CheckoutPage from './pages/CheckoutPage';
import StudioPage from './pages/StudioPage';
import StorePage from './pages/StorePage';
import EvidencePage from './pages/EvidencePage';
import DemoPlayer from './components/DemoPlayer';
import { Toaster } from 'sonner';

export default function App() {
  const location = useLocation();
  return (
    <div className="app">
      <header className="topbar">
        <Link to="/create" className="brand">DropLab</Link>
      </header>
      <main>
        <div key={location.pathname} className="route-fade">
        <Routes>
          <Route path="/" element={<CreatePage />} />
          <Route path="/create" element={<CreatePage />} />
          <Route path="/drop/:id" element={<DropPage />} />
          <Route path="/drop/:id/checkout" element={<CheckoutPage />} />
          <Route path="/drop/:id/studio" element={<StudioPage />} />
          <Route path="/drop/:id/store" element={<StorePage />} />
          <Route path="/drop/:id/evidence" element={<EvidencePage />} />
        </Routes>
        </div>
      </main>
      <DemoPlayer />
      {/* Top-right, clear of the demo's caption and control bar at the bottom. */}
      <Toaster position="top-right" richColors closeButton />
    </div>
  );
}
