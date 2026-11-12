"""Independent intake switches; synthetic images and disposable account only."""
import base64,hashlib,io,json,pathlib,tempfile,threading,types,unittest,sys
sys.path.insert(0,str(pathlib.Path(__file__).parent))
from PIL import Image
from wechat_sticker_collection import StickerCollection,MAX_ENTRIES
from wechat_sticker_manager import StickerManager
from wechat_meme_library import import_library_sticker,send_resources
from wechat_sticker_send import stage_sticker_image

KEY='wechat:private:123'
def gif(number):
    out=io.BytesIO();Image.new('RGB',(8,8),(number%256,number//256,0)).save(out,format='GIF');return out.getvalue()

class IntakeTests(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory(prefix='wechatgirl-intake-');self.addCleanup(self.temp.cleanup)
        self.root=pathlib.Path(self.temp.name);(self.root/'config').mkdir()
        self.policy={'whitelist':{'private':[123],'groups':[]},'stickers':{'collectEnabled':True,'collectDshEnabled':True},'memeLibrary':{'enabled':True}}
        self.save();self.pool=StickerCollection(self.root,self.root/'fictional-account','fictional-user')
        self.reader=types.SimpleNamespace(sticker_collection=self.pool,lock=threading.RLock(),account=types.SimpleNamespace(name='fictional-account'),sticker_labels=types.SimpleNamespace(save=lambda *args:None),pump_sticker_pool_review=lambda:None)
    def save(self):
        (self.root/'config/wechatagent.json').write_text(json.dumps({'wechat':self.policy}),encoding='utf8')
    def store(self,number,external=False):
        raw=gif(number);md5=hashlib.md5(raw).hexdigest();digest=hashlib.sha256(raw).hexdigest()
        return self.pool.store(raw,{'md5':md5,'len':len(raw)},md5,KEY,number+1,self.pool.bound_id(KEY,digest),external=external)
    def import_dsh(self,number):
        return import_library_sticker(self.reader,{'conversationKey':KEY,'b64':base64.b64encode(gif(number)).decode(),'description':'synthetic sticker','tags':['fixture']})
    def test_compatibility_image_preserves_the_selected_first_frame(self):
        output=io.BytesIO()
        Image.new('RGB',(8,8),'red').save(output,format='GIF',save_all=True,append_images=[Image.new('RGB',(8,8),'blue')],duration=100,loop=0)
        raw=output.getvalue()
        folder=self.root/'state/stickers'
        folder.mkdir(parents=True,exist_ok=True)
        source=folder/'animated.gif'
        source.write_bytes(raw)
        result=stage_sticker_image(self.root,{'id':'a'*64,'path':str(source),'fields':{'len':len(raw),'md5':hashlib.md5(raw).hexdigest()}})
        target=pathlib.Path(result['path'])
        self.assertTrue(target.is_relative_to(self.root/'state/hook/outgoing-images'))
        self.assertEqual(hashlib.md5(target.read_bytes()).hexdigest(),result['imageMd5'])
        with Image.open(target) as frame:
            self.assertEqual(frame.convert('RGB').getpixel((0,0)),(255,0,0))
            self.assertEqual(frame.n_frames,1)
        self.assertEqual(source.read_bytes(),raw)
    def test_four_combinations_and_temporary_send(self):
        for index,(wechat,dsh) in enumerate(((False,False),(True,False),(False,True),(True,True))):
            with self.subTest(wechat=wechat,dsh=dsh):
                self.policy['stickers'].update(collectEnabled=wechat,collectDshEnabled=dsh);self.save()
                before=len(self.pool.read()['entries'])
                self.assertEqual(self.store(index*2),wechat)
                reply=self.import_dsh(index*2+1)
                self.assertTrue(reply['ready']);self.assertEqual(reply['admitted'],dsh)
                self.assertEqual(reply['collection'],'saved' if dsh else 'disabled')
                self.assertEqual(len(self.pool.read()['entries']),before+int(wechat)+int(dsh))
                resource=send_resources(self.reader).resource(reply['id'],KEY)
                self.assertEqual(resource['origin'],'dsh-meme-temporary')
                self.assertTrue(pathlib.Path(resource['path']).is_file())
    def test_legacy_defaults_and_provenance_deduplication(self):
        self.policy['stickers']={'collectGroups':False};self.save()
        self.assertFalse(self.store(1));self.assertTrue(self.store(1,external=True))
        self.policy['stickers']['collectEnabled']=True;self.save();self.assertTrue(self.store(1))
        items=StickerManager(self.pool).listing()['items'];self.assertEqual(len(items),1)
        self.assertEqual(set(items[0]['collectionOrigins']),{'wechat','dsh'})
        state=self.pool.read();next(iter(state['entries'].values())).pop('collectionOrigins');self.pool.write(state)
        self.assertEqual(StickerManager(self.pool).listing()['items'][0]['collectionOrigins'],['legacy'])
    def fill(self):
        for i in range(MAX_ENTRIES):self.assertTrue(self.store(i))
    def test_dsh_only_full_pool_can_review_and_revocation_keeps_state(self):
        self.fill();self.policy['stickers']['collectEnabled']=False;self.save()
        result=self.import_dsh(100);self.assertEqual(result['collection'],'review-pending')
        review=self.pool.claim_review();self.assertIsNotNone(review)
        packet=self.pool.review_packet(review['ticket']);self.assertEqual(len(packet['items']),MAX_ENTRIES+1)
        self.policy['stickers']['collectDshEnabled']=False;self.save()
        before=self.pool.read()
        with self.assertRaises(PermissionError):self.pool.review_packet(review['ticket'])
        with self.assertRaises(PermissionError):self.pool.apply_review(review['ticket'],['P'+str(i+1) for i in range(MAX_ENTRIES)])
        self.assertEqual(self.pool.read(),before)
        self.policy['stickers']['collectDshEnabled']=True;self.save()
        keep=['P'+str(i+1) for i in range(MAX_ENTRIES-1)]+['N1']
        result=self.pool.apply_review(review['ticket'],keep);self.assertEqual(result['added'],1)
    def test_disabled_wechat_waiting_does_not_follow_dsh_switch(self):
        self.fill();self.assertFalse(self.store(100))
        self.policy['stickers']['collectEnabled']=False;self.save()
        self.assertIsNone(self.pool.claim_review())
        state=self.pool.read();self.assertEqual(len(state['waiting']),1);state['nextReviewAt']=0;self.pool.write(state)
        self.policy['stickers']['collectEnabled']=True;self.policy['stickers']['collectDshEnabled']=False;self.save()
        self.assertIsNotNone(self.pool.claim_review())
    def test_authorization_and_sending_switch_still_apply(self):
        self.policy['stickers']['collectEnabled']=False;self.policy['memeLibrary']['enabled']=False;self.save()
        self.assertFalse(self.store(1,external=True))
        with self.assertRaises(PermissionError):self.import_dsh(1)
        self.policy['memeLibrary']['enabled']=True;self.policy['stickers']['enabled']=False;self.save()
        with self.assertRaises(PermissionError):self.import_dsh(1)
    def test_close_dsh_while_preparing_does_not_admit_or_mark_pending(self):
        original=self.pool.store
        def revoked(*args,**kwargs):
            self.policy['stickers']['collectDshEnabled']=False;self.save();return original(*args,**kwargs)
        self.pool.store=revoked
        result=self.import_dsh(2);self.assertTrue(result['ready']);self.assertEqual(result['collection'],'disabled')
        self.assertEqual(self.pool.read()['entries'],{});self.assertEqual(self.pool.read()['waiting'],{})
    def test_revoked_dsh_chat_cannot_borrow_wechat_source_for_review(self):
        self.policy['whitelist']['private'].append(456);self.save();self.assertTrue(self.store(1))
        raw=gif(1);md5=hashlib.md5(raw).hexdigest();digest=hashlib.sha256(raw).hexdigest();other='wechat:private:456'
        self.assertTrue(self.pool.store(raw,{'md5':md5,'len':len(raw)},md5,other,2,self.pool.bound_id(other,digest),external=True))
        self.policy['stickers']['collectEnabled']=False;self.policy['memeLibrary']['chats']={other:False};self.save()
        item=self.pool.read()['entries'][digest];self.assertTrue(self.pool.usable(item,self.policy));self.assertFalse(self.pool.can_review(item,self.policy))

if __name__=='__main__':unittest.main()
