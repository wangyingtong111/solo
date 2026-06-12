import { BrowserRouter as Router, Routes, Route, Navigate } from "react-router-dom";
import Sidebar from "@/components/Sidebar";
import { Monitor } from "@/pages/Monitor";
import SOHPanel from "@/pages/SOHPanel";
import BalancePanel from "@/pages/BalancePanel";
import HistoryPanel from "@/pages/HistoryPanel";
import ReportPanel from "@/pages/ReportPanel";

export default function App() {
  return (
    <Router>
      <div className="flex h-screen w-full bg-bms-bg overflow-hidden">
        <Sidebar />
        <main className="flex-1 overflow-auto">
          <Routes>
            <Route path="/" element={<Navigate to="/monitor" replace />} />
            <Route path="/monitor" element={<Monitor />} />
            <Route path="/soh" element={<SOHPanel />} />
            <Route path="/balance" element={<BalancePanel />} />
            <Route path="/history" element={<HistoryPanel />} />
            <Route path="/report" element={<ReportPanel />} />
            <Route path="*" element={<Navigate to="/monitor" replace />} />
          </Routes>
        </main>
      </div>
    </Router>
  );
}
