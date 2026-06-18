import { useState } from "react";
import { Link } from "react-router-dom";
import { Menu, X, GraduationCap } from "lucide-react";
import { navLinks } from "../data/content.js";

export default function Navbar() {
  const [menuOpen, setMenuOpen] = useState(false);

  return (
    <nav className="sticky top-0 z-50 bg-white border-b border-gray-100 shadow-sm">
      <div className="max-w-7xl mx-auto px-4 flex items-center justify-between h-16">
        
        {/* Logo */}
        <Link to="/" className="flex items-center gap-2">
          <GraduationCap className="w-8 h-8 text-maroon" />
          <span className="font-heading text-xl font-bold text-maroon">
            EduReach
          </span>
        </Link>

        {/* Desktop links */}
        <div className="hidden md:flex items-center gap-6">
          {navLinks.map((link) => (
            <a
              key={link.label}
              href={link.href}
              className="text-gray-700 hover:text-maroon transition-colors duration-200 text-sm font-medium"
            >
              {link.label}
            </a>
          ))}
        </div>

        {/* Desktop buttons (UI only) */}
        <div className="hidden md:flex items-center gap-3">
          <button className="text-sm text-maroon font-medium hover:text-maroon-dark transition-colors duration-200">
            Login
          </button>
          <button className="text-sm bg-maroon text-white px-4 py-2 rounded-lg hover:bg-maroon-dark transition-colors duration-200">
            Sign Up
          </button>
        </div>

        {/* Mobile hamburger */}
        <button
          onClick={() => setMenuOpen(!menuOpen)}
          className="md:hidden text-gray-700"
        >
          {menuOpen ? <X className="w-6 h-6" /> : <Menu className="w-6 h-6" />}
        </button>
      </div>

      {/* Mobile menu */}
      {menuOpen && (
        <div className="md:hidden bg-white border-t border-gray-100 px-4 py-4 space-y-3">
          {navLinks.map((link) => (
            <a
              key={link.label}
              href={link.href}
              onClick={() => setMenuOpen(false)}
              className="block text-gray-700 hover:text-maroon transition-colors duration-200"
            >
              {link.label}
            </a>
          ))}

          <div className="pt-3 border-t border-gray-100 flex gap-3">
            <button
              onClick={() => setMenuOpen(false)}
              className="text-maroon font-medium"
            >
              Login
            </button>
            <button
              onClick={() => setMenuOpen(false)}
              className="bg-maroon text-white px-4 py-2 rounded-lg text-sm"
            >
              Sign Up
            </button>
          </div>
        </div>
      )}
    </nav>
  );
}