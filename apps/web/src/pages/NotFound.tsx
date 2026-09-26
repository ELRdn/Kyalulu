import { useNavigate } from "react-router-dom";
import Button from "../components/ui/Button";
import EmptyState from "../components/ui/EmptyState";
import { useDocumentTitle } from "../lib/title";
import "./pages.css";

export default function NotFound() {
  const navigate = useNavigate();
  useDocumentTitle("ページが見つかりません");
  return (
    <div className="k-page">
      <EmptyState
        mascot="shy"
        title="このページは、別の世界に迷いこんだみたい"
        description="URLが間違っているか、ページが移動した可能性があります。"
        action={
          <Button variant="primary" onClick={() => navigate("/")}>
            ホームへもどる
          </Button>
        }
      />
    </div>
  );
}
