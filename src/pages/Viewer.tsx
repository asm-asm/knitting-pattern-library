import { Link, useParams } from "react-router-dom";
import { EmptyState } from "../components/PatternParts";

// Phase 3 で PDF ビューアを実装するまでの仮ページ
export default function Viewer() {
  const { id } = useParams();
  return (
    <EmptyState title="PDFビューアは準備中です">
      <Link className="btn" to={`/patterns/${id}`}>
        作品に戻る
      </Link>
    </EmptyState>
  );
}
