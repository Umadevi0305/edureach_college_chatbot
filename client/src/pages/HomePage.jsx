import HeroSection from "../components/HeroSection.jsx";
import AboutSection from "../components/AboutSection.jsx";
import AchievementsSection from "../components/AchievementsSection.jsx";
import CoursesSection from "../components/CoursesSection.jsx";
import QuotesSection from "../components/QuotesSection.jsx";
import MentorsSection from "../components/MentorsSection.jsx";
import StudentLifeSection from "../components/StudentLifeSection.jsx";
import EventsGallery from "../components/EventsGallery.jsx";
import HiringStatsSection from "../components/HiringStatsSection.jsx";
import Footer from "../components/Footer.jsx";

export default function HomePage() {

  return (
    <div>
      <HeroSection />
      <AboutSection />
      <AchievementsSection />
      <CoursesSection />
      <QuotesSection />

      <MentorsSection />

      <StudentLifeSection />
      <EventsGallery />
      <HiringStatsSection />
      <Footer />

    </div>
  );
}