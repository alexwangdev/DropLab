import { Link, Route, Routes } from 'react-router-dom';
import CreatePage from './pages/CreatePage';
import DropPage from './pages/DropPage';
import CheckoutPage from './pages/CheckoutPage';
import StudioPage from './pages/StudioPage';

export default function App() {
  return (
    <div className="app">
      <header className="topbar">
        <Link to="/create" className="brand">DropLab</Link>
      </header>
      <main>
        <Routes>
          <Route path="/" element={<CreatePage />} />
          <Route path="/create" element={<CreatePage />} />
          <Route path="/drop/:id" element={<DropPage />} />
          <Route path="/drop/:id/checkout" element={<CheckoutPage />} />
          <Route path="/drop/:id/studio" element={<StudioPage />} />
        </Routes>
      </main>
    </div>
  );
}
