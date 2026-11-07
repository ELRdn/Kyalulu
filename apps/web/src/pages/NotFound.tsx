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
        mascot="cry"
        title={en ? "We couldn't find that page…" : 'そのページ、見当たらないみたい…'}
        action={
          <Button variant="primary" onClick={() => navigate("/")}>
            {en ? 'Back to home' : 'ホームにもどる'}
          </Button>
        }
      />
    </div>
  );
}
