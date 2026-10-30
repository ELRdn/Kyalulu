import { useNavigate } from "react-router-dom";
import Button from "../components/ui/Button";
import EmptyState from "../components/ui/EmptyState";
import { useDocumentTitle } from "../lib/title";
import { useLanguage } from "../lib/appContext";
import "./pages.css";

export default function NotFound() {
  const en = useLanguage() === 'en';
  const navigate = useNavigate();
  useDocumentTitle(en ? 'Page not found' : 'ページが見つかりません');
  return (
    <div className="k-page">
      <EmptyState
        mascot="shy"
        title={en ? 'This page seems to have wandered into another world' : 'このページは、別の世界に迷いこんだみたい'}
        description={en ? 'The URL may be incorrect, or the page may have moved.' : 'URLが間違っているか、ページが移動した可能性があります。'}
        action={
          <Button variant="primary" onClick={() => navigate("/")}>
            {en ? 'Back to home' : 'ホームへもどる'}
          </Button>
        }
      />
    </div>
  );
}
