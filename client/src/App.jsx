import { Routes, Route, Navigate } from "react-router-dom";
import Navbar from "./components/Navbar.jsx";
import FloatingChatButton from "./components/FloatingChatButton.jsx";
import HomePage from "./pages/HomePage.jsx";

function WithNavbar({ children }) {
  return (
    <>
      <Navbar />
      {children}
    </>
  );
}

export default function App() {
  return (
    <>
      <Routes>
        <Route path="/" element={<WithNavbar><HomePage /></WithNavbar>} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>

      {/* Floating chat button — visible on all pages */}
      <FloatingChatButton />
    </>
  );
}
