import { BrowserRouter as Router, Routes, Route } from "react-router-dom";
import Home from "@/pages/Home";
import Lobby from "@/pages/Lobby";
import Game from "@/pages/Game";
import { useSocketConnection } from "@/hooks/useSocket";

export default function App() {
  // 在顶层注册 socket 连接，确保跨页面导航时事件监听不丢失
  useSocketConnection();

  return (
    <Router>
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/lobby/:roomId" element={<Lobby />} />
        <Route path="/game/:roomId" element={<Game />} />
      </Routes>
    </Router>
  );
}
