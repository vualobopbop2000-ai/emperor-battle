const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
    cors: { origin: "*" }
});

// Serve các file tĩnh trong thư mục public
app.use(express.static(path.join(__dirname, 'public')));

// Quản lý danh sách phòng lưu trên RAM
const rooms = {};

io.on('connection', (socket) => {
    console.log(`[Connect] Người chơi kết nối: ${socket.id}`);

    // Gửi danh sách phòng hiện tại cho người chơi mới truy cập
    socket.emit('update-room-list', Object.values(rooms));

    // --- 1. Xử lý Tạo Phòng ---
    socket.on('create-room', ({ roomName, roomPass, username }, callback) => {
        const trimmedName = roomName ? roomName.trim() : "";
        if (!trimmedName) {
            return callback({ success: false, message: 'Tên phòng không được để trống!' });
        }

        // Kiểm tra trùng tên phòng
        const isDuplicate = Object.values(rooms).some(
            r => r.name.toLowerCase() === trimmedName.toLowerCase()
        );

        if (isDuplicate) {
            return callback({ success: false, message: 'Tên phòng bị trùng, đặt tên khác.' });
        }

        const roomId = 'room_' + Date.now();
        rooms[roomId] = {
            id: roomId,
            name: trimmedName,
            pass: roomPass || "",
            host: username || "Guest",
            players: [{ id: socket.id, name: username, role: 'player1' }]
        };

        socket.join(roomId);

        // Phát thông báo cập nhật danh sách phòng tới tất cả người chơi ở lobby
        io.emit('update-room-list', Object.values(rooms));

        callback({ success: true, roomId, role: 'player1' });
        console.log(`[Room Created] ${trimmedName} (${roomId}) bởi ${username}`);
    });

    // --- 2. Xử lý Vào Phòng ---
    socket.on('join-room', ({ roomId, roomPass, username }, callback) => {
        const room = rooms[roomId];

        if (!room) {
            return callback({ success: false, message: 'Phòng không tồn tại hoặc đã bị hủy!' });
        }

        if (room.pass && room.pass !== roomPass) {
            return callback({ success: false, message: 'Mật khẩu phòng không chính xác!' });
        }

        if (room.players.length >= 2) {
            return callback({ success: false, message: 'Phòng đã đầy (tối đa 2 người)!' });
        }

        const newPlayer = { id: socket.id, name: username, role: 'player2' };
        room.players.push(newPlayer);
        socket.join(roomId);

        callback({ success: true, role: 'player2' });

        // Báo cho cả 2 người chơi trong phòng là trận đấu chính thức bắt đầu
        io.to(roomId).emit('match-start', {
            roomId: roomId,
            players: room.players
        });

        io.emit('update-room-list', Object.values(rooms));
        console.log(`[Match Start] Phòng ${room.name} có đủ 2 người chơi!`);
    });

    // --- 3. Đồng bộ Thả Quân (Spawn Unit) ---
    socket.on('spawn-unit', ({ roomId, unitKey, position }) => {
        // Gửi tới người chơi còn lại trong phòng
        socket.to(roomId).emit('opponent-spawn-unit', { unitKey, position });
    });

    // --- 4. Đồng bộ Roll Buff Lotion ---
    socket.on('roll-lotion', ({ roomId, lotion }) => {
        socket.to(roomId).emit('opponent-roll-lotion', { lotion });
    });

    // --- 5. Xử lý Ngắt Kết Nối ---
    socket.on('disconnect', () => {
        console.log(`[Disconnect] Người chơi thoát: ${socket.id}`);
        for (const roomId in rooms) {
            const room = rooms[roomId];
            const playerIndex = room.players.findIndex(p => p.id === socket.id);

            if (playerIndex !== -1) {
                room.players.splice(playerIndex, 1);

                // Thông báo cho người còn lại nếu đối thủ rời trận
                socket.to(roomId).emit('opponent-left');

                // Xóa phòng nếu không còn ai
                if (room.players.length === 0) {
                    delete rooms[roomId];
                }

                io.emit('update-room-list', Object.values(rooms));
                break;
            }
        }
    });
});

const PORT = process.env.PORT || 8080;
server.listen(PORT, () => {
    console.log(`===========================================`);
    console.log(`🚀 Game Server đang chạy tại Port: ${PORT}`);
    console.log(`===========================================`);
});