import { BrowserRouter as Router, Routes, Route } from 'react-router-dom';
import { useEffect, useState } from 'react';
import Navbar from '@/components/layout/Navbar';
import AlertModal from '@/components/monitor/AlertModal';
import Home from '@/pages/Home';
import Waterfall from '@/pages/Waterfall';
import Prediction from '@/pages/Prediction';
import Settings from '@/pages/Settings';
import { useAppStore } from '@/store/useAppStore';
import type { Sensor } from '../../shared/types';

function AppContent() {
  const { setSensors } = useAppStore();
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    const fetchSensors = async () => {
      try {
        const res = await fetch('/api/sensors');
        const data = await res.json();
        if (data.success && data.sensors) {
          setSensors(data.sensors as Sensor[]);
        }
      } catch (e) {
        const defaultSensors: Sensor[] = Array.from({ length: 10 }, (_, i) => ({
          id: i + 1,
          name: `CH${i + 1}-传感器${i + 1}`,
          location: `监测点 ${i + 1}`,
          status: 'normal',
          sampleRate: 5000,
        }));
        setSensors(defaultSensors);
      }
      setLoaded(true);
    };

    fetchSensors();
  }, [setSensors]);

  if (!loaded) {
    return (
      <div className="min-h-screen bg-deep-space flex items-center justify-center">
        <div className="text-center">
          <div className="w-12 h-12 border-4 border-tech-cyan border-t-transparent rounded-full animate-spin mx-auto mb-4" />
          <p className="text-tech-cyan font-display">系统加载中...</p>
        </div>
      </div>
    );
  }

  return (
    <>
      <Navbar />
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/waterfall" element={<Waterfall />} />
        <Route path="/prediction" element={<Prediction />} />
        <Route path="/settings" element={<Settings />} />
      </Routes>
      <AlertModal />
    </>
  );
}

export default function App() {
  return (
    <Router>
      <AppContent />
    </Router>
  );
}
