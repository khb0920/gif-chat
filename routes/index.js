const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');

const Room = require('../schemas/room');
const Chat = require('../schemas/chat');
const { send } = require('process');
const { default: axios } = require('axios');
const { ok } = require('assert');

const router = express.Router();

router.get('/', async(req, res, next) => {
    try {
        const rooms = await Room.find({});
        res.render('main', { rooms, title: 'GIF 채팅방' });
    } catch (error) {
        console.error(error);
        next(error);
    }
});

router.get('/room', (req, res) => {
    res.render('room', { title: 'GIF 채팅방 생성' });
});

router.post('/room', async(req, res, next) => { //채팅방을 만드는 라우터
    try {
        const newRoom = await Room.create({
            title: req.body.title,
            max: req.body.max,
            owner: req.session.color,
            password: req.body.password,    
        });
        const io = req.app.get('io');   //app.set('io', io)로 저장했던 io객체를 가져옴
        io.of('/room').emit('newRoom', newRoom);
        res.redirect(`/room/${newRoom._id}?password=${req.body.password}`);
    } catch (error) {
        console.error(error);
        next(error);
    }
});

router.get('/room/:id', async(req, res, next) => {  //채팅방을 렌더링하는 라우터
    try {
        const room = await Room.findOne({ _id: req.params.id });
        const io = req.app.get('io');
        if(!room) {                                             //방이존재하는지 검사
            return res.redirect('/?error=방이 존재하지 않습니다');
        }
        if(room.password && room.password !== req.query.password){
            return res.redirect('/?error=비밀번호가 틀렸습니다');            
        }
        const { rooms } = io.of('/chat').adapter;        //방목록이 들어있음
        if(rooms && rooms[req.params.id] && room.max <= rooms[req.params.id].length){   // io.of('chat').adapter[req.params.id]에 방의
            return res.redirect('/?error=허용인원이 초과되었습니다');   //소켓 목록이나옴 소켓의 수를세서 참가인원수 계산
        }
        const chats = await Chat.find({ room: room._id }).sort('createdAt'); //방접속시 기존 채팅내역을 불러옴
        return res.render('chat', {
            room,
            title: room.title,
            chats,
            number: (rooms && rooms[req.params.id] && rooms[req.params.id].length + 1) || 1,
            user: req.session.color,
            owner: room.owner
        });
    } catch (error) {
        console.error(error);
        return next(error);
    }
});

router.delete('/room/:id', async(req, res, next) => {       //해당 채팅방 삭제
    try {
        await Room.remove({ _id: req.params.id });
        await Chat.remove({ room: req.params.id });
        res.send('ok');
        setTimeout(() => {
            req.app.get('io').of('/room').emit('removeRoom', req.params.id);
        }, 2000);
    } catch (error) {
        console.error(error);
        next(error);
    }
});

router.post('/room/:id/chat', async(req, res, next) => {    // 채팅 라우터
    try {
        const chat = new Chat({
            room: req.params.id,
            user: req.session.color,
            chat: req.body.chat,

        });
        await chat.save();
        res.send('ok');
        req.app.get('io').of('/chat').to(req.params.id).emit('chat', {
            socket: req.body.sid,
            room: req.params.id,
            user: req.session.color,
            chat: req.body.chat,
        });
    } catch (error) {
        console.error(error);
        next(error);
    }
});

try {
    fs.readdirSync('uploads');
} catch (error) {
    console.error('uploads 폴더를 생성합니다');
    fs.mkdirSync('uploads');
}
const upload = multer({
    storage: multer.diskStorage({
        destination(req, file, done){
            done(null, 'uploads/');
        },
        filename(req, file, done){
            const ext = path.extname(file.originalname);
            done(null, path.basename(file.originalname, ext) + Date.now() + ext);
        },
    }),
    limits: { fileSize: 5 * 1024 * 1024 },
});

router.post('/room/:id/gif', upload.single('gif'), async (req, res, next) => {
    try {
        const chat = new Chat({
            room: req.params.id,
            user: req.session.color,
            gif: req.file.filename,

        });
        await chat.save();
        res.send('ok');
        req.app.get('io').of('/chat').to(req.params.id).emit('chat', {
            socket: req.body.sid,
            room: req.params.id,
            user: req.session.color,
            gif: req.file.filename,
        });
    } catch (error) {
        console.error(error);
        next(error);
    }
  });

router.post('/room/:id/sys', async(req, res, next) => {
    try{
        const chat = req.body.type === 'join'
            ? `${req.session.color}님이 입장하셨습니다`
            : `${req.session.color}님이 퇴장하셨습니다`;
        const sys = new Chat({
            room: req.params.id,
            user: 'system',
            chat,
        });
        await sys.save();
        req.app.get('io').of('/chat').to(req.params.id).emit(req.body.type, {
            user: 'system',
            chat,
            number: req.app.get('io').of('/chat').adapter.rooms[req.params.id].length 
       });
       res.send('ok');
    } catch (error) {
        console.error(error);
        next(error);
    }
});


module.exports = router;