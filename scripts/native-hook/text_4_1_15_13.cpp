// Native text/image/mention APIs for the exact 4.1.15.13 x64 profile.
// No UIA, input simulation, desktop hooks or window activation.
#define WIN32_LEAN_AND_MEAN
#include <Windows.h>
#include <winternl.h>
#include <atomic>
#include <chrono>
#include <cstring>
#include <cwctype>
#include <filesystem>
#include <fstream>
#include <functional>
#include <future>
#include <memory>
#include <mutex>
#include <set>
#include <vector>
#include <regex>
#include "text_profile_4_1_15_13.h"
#include "httplib.h"
#include "json.hpp"

using json=nlohmann::json;
namespace {
using namespace WeChatAgentText41513;
std::filesystem::path ConfigFile;
uintptr_t base=0;std::mutex sendMutex;std::atomic<bool> probeReady{false},faulted{false};
std::atomic<bool> voiceReady{false};
std::atomic<bool> stickerReady{false},stickerBusy{false};
std::atomic<unsigned> phase{0};
std::atomic<uintptr_t> actualMessageTable{0},receiverLength{0},receiverCapacity{0},contentLength{0},contentCapacity{0};
std::string nativeCppError;
using Allocate=void*(__fastcall*)(size_t);
using Free=void(__fastcall*)(void*,size_t);
using Constructor=uintptr_t(__fastcall*)(void*);
using Factory=uintptr_t(__fastcall*)(void*,void*,void*,void*,void*,uintptr_t);
using Send=uintptr_t(__fastcall*)(void*,void*);

json Config(){std::ifstream file(ConfigFile);if(!file)throw std::runtime_error("native config missing");return json::parse(file);}
void Event(const char* name){
    std::ofstream f(ConfigFile.parent_path()/L"native-backend-events.jsonl",std::ios::app);
    if(f)f<<json({{"event",name},{"pid",GetCurrentProcessId()},{"phase",phase.load()},{"tick",GetTickCount64()}}).dump()<<'\n';
}
std::string Utf8(const std::wstring& text){
    int n=WideCharToMultiByte(CP_UTF8,0,text.data(),static_cast<int>(text.size()),nullptr,0,nullptr,nullptr);
    std::string out(n,'\0');if(n)WideCharToMultiByte(CP_UTF8,0,text.data(),static_cast<int>(text.size()),out.data(),n,nullptr,nullptr);return out;
}
std::string Version(){
    std::vector<wchar_t> path(32768);const DWORD length=GetModuleFileNameW(reinterpret_cast<HMODULE>(base),path.data(),static_cast<DWORD>(path.size()));
    if(!length||length>=path.size())return "";
    DWORD ignored=0,size=GetFileVersionInfoSizeW(path.data(),&ignored);if(!size)return "";
    std::vector<BYTE> data(size);if(!GetFileVersionInfoW(path.data(),0,size,data.data()))return "";
    VS_FIXEDFILEINFO* info=nullptr;UINT infoLength=0;if(!VerQueryValueW(data.data(),L"\\",reinterpret_cast<void**>(&info),&infoLength)||!info)return "";
    return std::to_string(HIWORD(info->dwFileVersionMS))+"."+std::to_string(LOWORD(info->dwFileVersionMS))+"."+
      std::to_string(HIWORD(info->dwFileVersionLS))+"."+std::to_string(LOWORD(info->dwFileVersionLS));
}
bool ProfileMatches(){
    if(!base||Version()!="4.1.15.13")return false;
    auto* dos=reinterpret_cast<IMAGE_DOS_HEADER*>(base);
    auto* pe=reinterpret_cast<IMAGE_NT_HEADERS64*>(base+dos->e_lfanew);
    if(pe->OptionalHeader.SizeOfImage!=ImageSize)return false;
    const BYTE entry[]={0x55,0x41,0x56,0x56,0x57,0x53,0x48,0x81,0xec,0xe0,1,0,0};
    if(memcmp(reinterpret_cast<void*>(base+SendRva),entry,sizeof(entry)))return false;
    if(*reinterpret_cast<uintptr_t*>(base+SenderTable+16)!=base+SendRva)return false;
    const uintptr_t code[]={SendRva,TextCtorRva,ImageCtorRva,FactoryRva,AllocateRva,FreeRva};
    for(auto rva:code){MEMORY_BASIC_INFORMATION m{};
        if(!VirtualQuery(reinterpret_cast<void*>(base+rva),&m,sizeof(m))||m.State!=MEM_COMMIT||
          !(m.Protect&(PAGE_EXECUTE|PAGE_EXECUTE_READ|PAGE_EXECUTE_READWRITE|PAGE_EXECUTE_WRITECOPY)))return false;
    }
    return true;
}
// Account metadata only, obtained from handles already open in this WeChat process.
struct HandleEntry{HANDLE value;ULONG_PTR handleCount,pointerCount;ULONG access,type,attributes,reserved;};
struct HandleSnapshot{ULONG_PTR count,reserved;HandleEntry entries[1];};
std::set<std::string> Accounts(){
    using Query=NTSTATUS(NTAPI*)(HANDLE,ULONG,PVOID,ULONG,PULONG);
    auto query=reinterpret_cast<Query>(GetProcAddress(GetModuleHandleW(L"ntdll.dll"),"NtQueryInformationProcess"));
    if(!query)return {};
    std::vector<BYTE> buffer(65536);ULONG required=0;
    auto status=query(GetCurrentProcess(),51,buffer.data(),static_cast<ULONG>(buffer.size()),&required);
    if(status<0&&required>buffer.size()&&required<16*1024*1024){buffer.resize(required+4096);status=query(GetCurrentProcess(),51,buffer.data(),static_cast<ULONG>(buffer.size()),&required);}
    if(status<0)return {};
    auto* snapshot=reinterpret_cast<HandleSnapshot*>(buffer.data());
    if(snapshot->count>(buffer.size()-2*sizeof(ULONG_PTR))/sizeof(HandleEntry))return {};
    std::set<std::string> accounts;
    std::vector<wchar_t> name(32768);
    for(ULONG_PTR i=0;i<snapshot->count;++i){
        auto file=snapshot->entries[i].value;if(GetFileType(file)!=FILE_TYPE_DISK)continue;
        DWORD n=GetFinalPathNameByHandleW(file,name.data(),static_cast<DWORD>(name.size()),FILE_NAME_NORMALIZED);if(!n||n>=name.size())continue;
        std::wstring path(name.data(),n);for(auto& ch:path){if(ch==L'/')ch=L'\\';ch=towlower(ch);}
        auto at=path.find(L"\\db_storage\\");if(at==std::wstring::npos)continue;
        auto previous=path.rfind(L'\\',at-1);if(previous!=std::wstring::npos)accounts.insert(Utf8(path.substr(previous+1,at-previous-1)));
    }
    return accounts;
}
void* New(size_t size){auto* p=reinterpret_cast<Allocate>(base+AllocateRva)(size);if(!p)throw std::bad_alloc();memset(p,0,size);return p;}
void Delete(void* p,size_t size){if(p)reinterpret_cast<Free>(base+FreeRva)(p,size);}
uintptr_t& Word(void* p,size_t offset){return *reinterpret_cast<uintptr_t*>(static_cast<BYTE*>(p)+offset);}
void ReleaseShared(uintptr_t control){
    if(!control)return;
    auto* counts=reinterpret_cast<volatile LONG*>(control+8);
    if(InterlockedDecrement(counts)==0){
        auto* table=*reinterpret_cast<uintptr_t**>(control);reinterpret_cast<void(__fastcall*)(void*)>(table[0])(reinterpret_cast<void*>(control));
        if(InterlockedDecrement(counts+1)==0)reinterpret_cast<void(__fastcall*)(void*)>(table[1])(reinterpret_cast<void*>(control));
    }
}
void SetString(void* where,const std::string& value){
    if(Word(where,16)!=0||Word(where,24)!=15)throw std::runtime_error("native string was not empty");
    Word(where,16)=value.size();
    if(value.size()<16){memcpy(where,value.data(),value.size());static_cast<char*>(where)[value.size()]=0;return;}
    const size_t capacity=value.size()|15;void* buffer;
    if(capacity+1>=4096){
        void* original=New(capacity+40);buffer=reinterpret_cast<void*>((reinterpret_cast<uintptr_t>(original)+39)&~uintptr_t(31));
        reinterpret_cast<void**>(buffer)[-1]=original;
    }else buffer=New(capacity+1);
    memcpy(buffer,value.data(),value.size());static_cast<char*>(buffer)[value.size()]=0;
    Word(where,0)=reinterpret_cast<uintptr_t>(buffer);Word(where,24)=capacity;
}
void SetWideString(void* where,const std::wstring& value){
    if(Word(where,16)!=0||Word(where,24)!=7)throw std::runtime_error("native wide string was not empty");
    Word(where,16)=value.size();
    if(value.size()<8){memcpy(where,value.c_str(),(value.size()+1)*sizeof(wchar_t));return;}
    const size_t capacity=value.size()|7,bytes=(capacity+1)*sizeof(wchar_t);void* buffer;
    if(bytes>=4096){void* original=New(bytes+39);buffer=reinterpret_cast<void*>((reinterpret_cast<uintptr_t>(original)+39)&~uintptr_t(31));
        reinterpret_cast<void**>(buffer)[-1]=original;
    }else buffer=New(bytes);
    memcpy(buffer,value.c_str(),(value.size()+1)*sizeof(wchar_t));Word(where,0)=reinterpret_cast<uintptr_t>(buffer);Word(where,24)=capacity;
}
std::filesystem::path CheckedImage(const std::string& value,const std::filesystem::path& root){
    if(root.empty()||!root.is_absolute()||value.empty()||value.size()>32768||value.find('\0')!=std::string::npos)throw std::runtime_error("invalid image path/root");
    const auto candidate=std::filesystem::u8path(value);if(!candidate.is_absolute())throw std::runtime_error("absolute image path required");
    const auto file=std::filesystem::weakly_canonical(candidate);
    const auto relative=file.lexically_relative(std::filesystem::weakly_canonical(root));
    if(relative.empty()||relative.is_absolute()||*relative.begin()==L".."||!std::filesystem::is_regular_file(file))throw std::runtime_error("image outside configured outgoing directory");
    const auto size=std::filesystem::file_size(file);if(!size||size>32*1024*1024)throw std::runtime_error("invalid image size");
    std::ifstream input(file,std::ios::binary);unsigned char header[12]{};input.read(reinterpret_cast<char*>(header),12);
    const bool png=!memcmp(header,"\x89PNG\r\n\x1a\n",8),jpeg=header[0]==0xff&&header[1]==0xd8&&header[2]==0xff,
      webp=!memcmp(header,"RIFF",4)&&!memcmp(header+8,"WEBP",4);
    if(!png&&!jpeg&&!webp)throw std::runtime_error("only PNG, JPEG and WebP are supported");
    return file;
}
bool ValidTarget(const std::string& value){return !value.empty()&&value.size()<=256&&value.find('\0')==std::string::npos;}
std::string ReadSilk(const std::string& value,const std::filesystem::path& root,uint64_t expected){
    if(root.empty()||!root.is_absolute()||value.empty()||value.find('\0')!=std::string::npos||expected<12||expected>1024*1024)
        throw std::runtime_error("invalid SILK path or size");
    const auto candidate=std::filesystem::u8path(value);
    if(!candidate.is_absolute())throw std::runtime_error("absolute SILK path required");
    const auto file=std::filesystem::canonical(candidate);
    if(file.parent_path()!=std::filesystem::canonical(root)||file.extension()!=L".silk"||!std::filesystem::is_regular_file(file)||std::filesystem::file_size(file)!=expected)
        throw std::runtime_error("SILK outside outgoing directory or size mismatch");
    std::ifstream stream(file,std::ios::binary);
    std::string silk(static_cast<size_t>(expected),'\0');stream.read(&silk[0],static_cast<std::streamsize>(silk.size()));
    if(!stream||stream.peek()!=std::char_traits<char>::eof()||silk.compare(0,10,"\x02#!SILK_V3")!=0)
        throw std::runtime_error("invalid Tencent SILK");
    return silk;
}
std::string MentionList(const json& values){
    if(!values.is_array()||values.empty()||values.size()>8)throw std::runtime_error("expected 1-8 member IDs");
    std::string ids;std::set<std::string> seen;
    for(const auto& value:values){
        if(!value.is_string())throw std::runtime_error("invalid member ID");const auto id=value.get<std::string>();
        if(id.empty()||id.size()>128||id.find_first_not_of("abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789_-")!=std::string::npos)throw std::runtime_error("invalid member ID");
        if(seen.insert(id).second){if(!ids.empty())ids+=",";ids+=id;}
    }return ids;
}
struct Prepared{
    void* sender=nullptr;void* params=nullptr;void* owner=nullptr;bool senderOwnsMessage=false;
    ~Prepared(){
        if(sender&&senderOwnsMessage){auto* table=*reinterpret_cast<uintptr_t**>(sender);
            reinterpret_cast<void(__fastcall*)(void*,bool)>(table[4])(sender,true);
        }else{
            if(sender)Delete(sender,0x28);
            if(owner)ReleaseShared(reinterpret_cast<uintptr_t>(owner));
        }
        if(params){
            for(size_t offset:{size_t(0x10),size_t(0x50),size_t(0x90)}){
                auto object=Word(params,offset+0x38);if(!object)continue;
                auto* table=*reinterpret_cast<uintptr_t**>(object);
                reinterpret_cast<void(__fastcall*)(void*,bool)>(table[4])(reinterpret_cast<void*>(object),object!=reinterpret_cast<uintptr_t>(params)+offset);
            }
            ReleaseShared(Word(params,8));Delete(params,0xe8);
        }
    }
    void Build(const std::string& target,const std::string& text,bool image=false,uint64_t bytes=0,const std::string& atList=""){
        phase=1;owner=New(image?0x900:0x800);Word(owner,0)=base+(image?ImageOwnerTable:OwnerTable);Word(owner,8)=0x100000001;
        void* message=static_cast<BYTE*>(owner)+16;
        reinterpret_cast<Constructor>(base+(image?ImageCtorRva:TextCtorRva))(message);phase=2;
        actualMessageTable=Word(message,0)-base;receiverLength=Word(message,0xc0);receiverCapacity=Word(message,0xc8);
        contentLength=Word(message,0x768);contentCapacity=Word(message,0x770);
        if(Word(message,0)!=base+(image?ImageMessageTable:MessageTable))throw std::runtime_error("native message type mismatch");
        SetString(static_cast<BYTE*>(message)+0xb0,target);
        if(image){const auto file=std::filesystem::u8path(text);SetWideString(static_cast<BYTE*>(message)+0x120,file.wstring());
            SetString(static_cast<BYTE*>(message)+0x1a8,file.filename().u8string());Word(message,0x118)=3;Word(message,0x1c8)=bytes;
        }else{
            SetString(static_cast<BYTE*>(message)+0x758,text);Word(message,0x118)=1;Word(message,0x1c8)=text.size();
            // Reflection in this exact core: +0x758=text_content, +0x778=at_user_list.
            // Preserve the constructor's native string ownership, including long ID lists.
            if(!atList.empty())SetString(static_cast<BYTE*>(message)+0x778,atList);
        }
        BuildDispatch(message);
    }
    void BuildVoice(const std::string& target,const std::string& silk,uint32_t duration){
        struct VoiceInfo{int32_t codec=4,format=3,bitrate=30000,reserved=0;uint64_t flag=0;std::string extra;};
        static_assert(offsetof(VoiceInfo,extra)==0x18&&sizeof(std::string)==32,"voice factory ABI differs");
        VoiceInfo info;void* pair[2]{};
        using VoiceFactory=void*(__fastcall*)(void**,const std::string*,const std::string*,const uint32_t*,const VoiceInfo*);
        reinterpret_cast<VoiceFactory>(base+VoiceFactoryRva)(pair,&target,&silk,&duration,&info);
        auto* message=pair[0];owner=pair[1];
        if(!message||!owner||static_cast<BYTE*>(owner)+16!=message||Word(owner,0)!=base+VoiceOwnerTable||
            Word(message,0)!=base+VoiceMessageTable||Word(message,0xc0)!=target.size()||Word(message,0x768)!=silk.size()||
            *reinterpret_cast<uint32_t*>(static_cast<BYTE*>(message)+0x778)!=duration)
            throw std::runtime_error("native voice message layout mismatch");
        *reinterpret_cast<uint32_t*>(static_cast<BYTE*>(message)+0x118)=34;
        BuildDispatch(message);
    }
    void BuildDispatch(void* message){
        sender=New(0x28);
        void* vector=New(0x20);Word(vector,0)=reinterpret_cast<uintptr_t>(message);Word(vector,8)=reinterpret_cast<uintptr_t>(owner);
        Word(sender,0)=base+SenderTable;Word(sender,8)=reinterpret_cast<uintptr_t>(vector);
        Word(sender,16)=reinterpret_cast<uintptr_t>(vector)+16;Word(sender,24)=reinterpret_cast<uintptr_t>(vector)+16;Word(sender,32)=1;
        senderOwnsMessage=true;phase=3;
        // Valid MSVC std::function objects, with no UI owners or captured QObject lifetimes.
        // Native callbacks return void; extra Win64 register arguments are not consumed.
        static_assert(sizeof(std::function<void()>)==64,"std::function ABI differs");
        std::function<void()> first=[](){},second=[](){},third=[](){};
        uintptr_t shared[2]{};params=New(0xe8);
        reinterpret_cast<Factory>(base+FactoryRva)(params,&first,&second,&third,shared,1);
        if(!Word(params,0x48)||!Word(params,0x88)||!Word(params,0xc8)||Word(params,0xd0)!=1)
            throw std::runtime_error("native callback layout mismatch");
        phase=4;
    }
};
void Probe(){
    {Prepared p;p.Build("filehelper","native construction probe");}
    {Prepared p;p.Build("filehelper","native image construction probe.png",true,1);}
    {Prepared p;p.Build("native_probe@chatroom","native mention construction",false,0,"wxid_native_probe");}
}
void Submit(const std::string& target,const std::string& text){Prepared p;p.Build(target,text);phase=5;
    reinterpret_cast<Send>(base+SendRva)(p.sender,p.params);phase=6;}
void ProbeCatching(){nativeCppError.clear();try{Probe();}catch(const std::exception& e){nativeCppError=e.what();}}
void SubmitCatching(const std::string& target,const std::string& text){nativeCppError.clear();try{Submit(target,text);}catch(const std::exception& e){nativeCppError=e.what();}}
// SEH only wraps a primitive call boundary. It is not used to continue a failed native operation.
DWORD GuardProbe(){__try{ProbeCatching();return 0;}__except(EXCEPTION_EXECUTE_HANDLER){return GetExceptionCode();}}
DWORD GuardSubmit(const std::string* target,const std::string* text){__try{SubmitCatching(*target,*text);return 0;}__except(EXCEPTION_EXECUTE_HANDLER){return GetExceptionCode();}}
void ImageCatching(const std::string& target,const std::string& file,uint64_t bytes){nativeCppError.clear();try{
    Prepared p;p.Build(target,file,true,bytes);phase=5;reinterpret_cast<Send>(base+SendRva)(p.sender,p.params);phase=6;
}catch(const std::exception& e){nativeCppError=e.what();}}
DWORD GuardImage(const std::string* target,const std::string* file,uint64_t bytes){__try{ImageCatching(*target,*file,bytes);return 0;}__except(EXCEPTION_EXECUTE_HANDLER){return GetExceptionCode();}}
void MentionCatching(const std::string& target,const std::string& text,const std::string& ids){nativeCppError.clear();try{
    Prepared p;p.Build(target,text,false,0,ids);phase=5;reinterpret_cast<Send>(base+SendRva)(p.sender,p.params);phase=6;
}catch(const std::exception& e){nativeCppError=e.what();}}
DWORD GuardMention(const std::string* target,const std::string* text,const std::string* ids){__try{MentionCatching(*target,*text,*ids);return 0;}__except(EXCEPTION_EXECUTE_HANDLER){return GetExceptionCode();}}
void VoiceCatching(const std::string& target,const std::string& silk,uint32_t duration,bool submit){
    nativeCppError.clear();
    try{Prepared p;p.BuildVoice(target,silk,duration);if(submit)reinterpret_cast<Send>(base+SendRva)(p.sender,p.params);}
    catch(const std::exception& e){nativeCppError=e.what();}
}
DWORD GuardVoice(const std::string* target,const std::string* silk,uint32_t duration,bool submit){
    __try{VoiceCatching(*target,*silk,duration,submit);return 0;}__except(EXCEPTION_EXECUTE_HANDLER){return GetExceptionCode();}
}

bool StickerProfileMatches(){
    const BYTE factory[]={0x55,0x56,0x57,0x48,0x83,0xec,0x30,0x48,0x8d,0x6c,0x24,0x30};
    const BYTE scheduler[]={0x55,0x41,0x57,0x41,0x56,0x56,0x57,0x53,0x48,0x81,0xec,0xc8};
    const BYTE queue[]={0x55,0x41,0x57,0x41,0x56,0x56,0x57,0x53,0x48,0x83,0xec,0x78};
    return !memcmp(reinterpret_cast<void*>(base+StickerFactoryRva),factory,sizeof(factory))&&
        !memcmp(reinterpret_cast<void*>(base+PostTaskRva),scheduler,sizeof(scheduler))&&
        !memcmp(reinterpret_cast<void*>(base+QueueMessageRva),queue,sizeof(queue));
}
std::wstring CheckedSticker(const std::string& value,const std::filesystem::path& root,const json& fields){
    const auto md5=fields.value("md5","");
    const auto size=fields.at("len").get<int64_t>();
    if(!root.is_absolute()||value.empty()||value.size()>1023||value.find('\0')!=std::string::npos||
       md5.size()!=32||md5.find_first_not_of("0123456789abcdef")!=std::string::npos||size<14||size>1024*1024)
        throw std::runtime_error("invalid GIF metadata");
    const auto supplied=std::filesystem::u8path(value);
    if(!supplied.is_absolute()||std::filesystem::is_symlink(supplied))throw std::runtime_error("invalid GIF path");
    const auto file=std::filesystem::canonical(supplied);
    if(file.parent_path()!=std::filesystem::canonical(root)||file.filename().u8string()!=md5+".gif"||
       !std::filesystem::is_regular_file(file)||std::filesystem::file_size(file)!=static_cast<uint64_t>(size))
        throw std::runtime_error("GIF outside outgoing directory or size mismatch");
    std::ifstream in(file,std::ios::binary);
    unsigned char header[10]{};
    in.read(reinterpret_cast<char*>(header),sizeof(header));
    const auto width=header[6]+256*header[7],height=header[8]+256*header[9];
    if(!in||(memcmp(header,"GIF87a",6)&&memcmp(header,"GIF89a",6))||
       width<1||width>1024||height<1||height>1024)throw std::runtime_error("invalid GIF header or dimensions");
    return file.wstring();
}
struct NativeReference{
    void* object=nullptr;uintptr_t control=0;
    explicit operator bool()const{return object&&control;}
};
struct OwnedNativeReference:NativeReference{
    ~OwnedNativeReference(){ReleaseShared(control);}
};
struct GifInspection{
    uint64_t valid=0;
    uintptr_t image[2]{};
    uint32_t width=0,height=0;
    ~GifInspection(){if(image[0])reinterpret_cast<void(__fastcall*)(void*)>(base+ReleaseGifImageRva)(image);}
};
static_assert(sizeof(NativeReference)==16&&sizeof(GifInspection)==32,"unexpected sticker ABI");
struct StickerResult{
    uint64_t status=UINT64_MAX;
    alignas(8) unsigned char reason[32]{};
    NativeReference reference{};
    unsigned char reserved[72]{};
    ~StickerResult(){
        ReleaseShared(reference.control);
        const auto capacity=Word(reason,24);
        if(capacity<=15||capacity>=1024*1024)return;
        auto* memory=reinterpret_cast<void*>(Word(reason,0));
        auto size=capacity+1;
        if(size>=4096){memory=reinterpret_cast<void**>(memory)[-1];size+=39;}
        Delete(memory,size);
    }
};
static_assert(sizeof(StickerResult)==128,"unexpected send result ABI");
bool StickerAccountMatches(const OwnedNativeReference& context,const std::string& bound){
    if(!context||Word(context.object,0)!=base+AccountTable)return false;
    auto* id=static_cast<BYTE*>(context.object)+0x48;
    const auto size=Word(id,16),capacity=Word(id,24);
    if(!size||size>128||capacity<size||capacity>4096||size>bound.size())return false;
    const auto* value=capacity<=15?reinterpret_cast<const char*>(id):*reinterpret_cast<char* const*>(id);
    if(!value||memcmp(bound.data(),value,size))return false;
    return bound.size()==size||(bound.size()==size+5&&bound[size]=='_'&&
        bound.find_first_not_of("0123456789abcdefghijklmnopqrstuvwxyz",size+1)==std::string::npos);
}
enum class StickerOutcome{accepted,rejected,unavailable,uncertain};
StickerOutcome SendStickerOnTask(const std::string& target,const std::wstring& file,const std::string& account,bool send){
    using GetReference=NativeReference*(__fastcall*)(NativeReference*);
    using GetChild=NativeReference*(__fastcall*)(void*,NativeReference*);
    using Validate=int(__fastcall*)(const std::wstring*);
    using Inspect=GifInspection*(__fastcall*)(GifInspection*,const std::wstring*);
    using Queue=void*(__fastcall*)(void*,StickerResult*,NativeReference*,uint8_t);
    static_assert(sizeof(std::wstring)==32,"unexpected path ABI");
    OwnedNativeReference context,service,manager,message,current;
    reinterpret_cast<GetReference>(base+AccountContextRva)(&context);
    if(!StickerAccountMatches(context,account))return StickerOutcome::unavailable;
    if(reinterpret_cast<Validate>(base+CheckGifRva)(&file)!=2)return StickerOutcome::rejected;
    GifInspection details;
    reinterpret_cast<Inspect>(base+InspectGifRva)(&details,&file);
    if(!(details.valid&0xff)||!details.width||details.width>1024||!details.height||details.height>1024)return StickerOutcome::rejected;
    reinterpret_cast<GetReference>(base+StickerFactoryRva)(&message);
    if(!message||Word(message.object,0)!=base+StickerMessageTable)return StickerOutcome::unavailable;
    auto* bytes=static_cast<BYTE*>(message.object);
    *reinterpret_cast<uint32_t*>(bytes+0x118)=47;
    Word(bytes,0x778)=uint64_t(details.width)|(uint64_t(details.height)<<32);
    SetString(bytes+0xb0,target);
    SetWideString(bytes+0x120,file);
    if(!send)return StickerOutcome::accepted;
    reinterpret_cast<GetChild>(base+ServicesRva)(context.object,&service);
    if(!service)return StickerOutcome::unavailable;
    reinterpret_cast<GetChild>(base+MessageManagerRva)(service.object,&manager);
    reinterpret_cast<GetReference>(base+AccountContextRva)(&current);
    if(!manager||current.object!=context.object||!StickerAccountMatches(current,account)||
       Accounts()!=std::set<std::string>{account})return StickerOutcome::unavailable;
    StickerResult result;
    NativeReference queued=message;
    InterlockedIncrement(reinterpret_cast<volatile LONG*>(message.control+8));
    reinterpret_cast<Queue>(base+QueueMessageRva)(manager.object,&result,&queued,1);
    return result.status==0?StickerOutcome::accepted:StickerOutcome::uncertain;
}
void RunStickerCatching(const std::string& target,const std::wstring& file,const std::string& account,bool send,StickerOutcome& result){
    try{result=SendStickerOnTask(target,file,account,send);}catch(...){result=StickerOutcome::uncertain;}
}
DWORD GuardStickerTask(const std::string* target,const std::wstring* file,const std::string* account,bool send,StickerOutcome* result){
    __try{RunStickerCatching(*target,*file,*account,send,*result);return 0;}__except(EXCEPTION_EXECUTE_HANDLER){return GetExceptionCode();}
}
bool PostStickerTask(std::function<void()>& callback){
    struct Location{const char* function;const char* source;uint32_t line,reserved;void* address;};
    static_assert(sizeof(Location)==32&&sizeof(std::function<void()>)==64,"unexpected scheduler ABI");
    using GetApp=void*(__fastcall*)();
    using GetScheduler=NativeReference*(__fastcall*)(void*,NativeReference*);
    using Post=NativeReference*(__fastcall*)(void*,NativeReference*,Location*,std::function<void()>*,uint32_t);
    static Location location{"WeChatGirl.SendSticker","WeChatGirl",1,0,nullptr};
    void* app=reinterpret_cast<GetApp>(base+ApplicationRva)();
    if(!app)return false;
    OwnedNativeReference scheduler,task;
    reinterpret_cast<GetScheduler>(base+SchedulerRva)(app,&scheduler);
    if(!scheduler)return false;
    reinterpret_cast<Post>(base+PostTaskRva)(scheduler.object,&task,&location,&callback,1);
    return true;
}
DWORD GuardStickerSchedule(std::function<void()>* callback,bool* posted){
    __try{*posted=PostStickerTask(*callback);return 0;}__except(EXCEPTION_EXECUTE_HANDLER){return GetExceptionCode();}
}
StickerOutcome ScheduleSticker(const std::string& target,const std::wstring& file,const std::string& account,bool send){
    struct Job{std::atomic<int> phase{0};std::promise<StickerOutcome> result;};
    auto job=std::make_shared<Job>();
    auto completion=job->result.get_future();
    std::function<void()> callback=[job,target,file,account,send]{
        int waiting=0;
        if(!job->phase.compare_exchange_strong(waiting,1))return;
        StickerOutcome result=StickerOutcome::uncertain;
        if(GuardStickerTask(&target,&file,&account,send,&result)||result==StickerOutcome::uncertain)stickerReady=false;
        stickerBusy=false;
        job->result.set_value(result);
    };
    if(stickerBusy.exchange(true))return StickerOutcome::unavailable;
    bool posted=false;
    if(GuardStickerSchedule(&callback,&posted)||!posted){
        int waiting=0;
        if(job->phase.compare_exchange_strong(waiting,2))stickerBusy=false;
        stickerReady=false;
        return StickerOutcome::uncertain;
    }
    if(completion.wait_for(std::chrono::seconds(4))==std::future_status::ready)return completion.get();
    int waiting=0;
    if(job->phase.compare_exchange_strong(waiting,2)){
        stickerBusy=false;
        return StickerOutcome::unavailable;
    }
    return StickerOutcome::uncertain;
}

DWORD WINAPI Run(void* module){
    std::vector<wchar_t> path(32768);
    const DWORD length=GetModuleFileNameW(static_cast<HMODULE>(module),path.data(),static_cast<DWORD>(path.size()));
    if(!length||length>=path.size())return 6;
    ConfigFile=std::filesystem::path(path.data()).parent_path()/L"wechatagent-hook.json";
    base=reinterpret_cast<uintptr_t>(GetModuleHandleW(L"Weixin.dll"));
    if(!ProfileMatches()){Event("profile-mismatch");return 1;}
    json config;try{config=Config();}catch(...){Event("config-unavailable");return 2;}
    std::ifstream tokenFile(ConfigFile.parent_path()/L"wechatagent-hook.token");
    std::string token;std::getline(tokenFile,token);if(!token.empty()&&token.back()=='\r')token.pop_back();
    if(token.size()!=64||config.value("expectedVersion","")!="4.1.15.13"){Event("config-invalid");return 3;}
    const auto startupFault=GuardProbe();
    if(startupFault||!nativeCppError.empty()){faulted=true;Event("construction-probe-failed");return 5;}
    probeReady=true;
    const BYTE voiceCaller[]={0xe8,0x0f,0x04,0,0,0x48,0x8b,0x45,0xe0,0xc7,0x80,0x18,0x01,0,0,0x22,0,0,0};
    if(std::filesystem::u8path(config.value("voiceRoot","")).is_absolute()&&!memcmp(reinterpret_cast<void*>(base+0x6bdfc0c),voiceCaller,sizeof(voiceCaller))){
        const std::string probeTarget="filehelper",probeSilk="voice construction probe";
        voiceReady=GuardVoice(&probeTarget,&probeSilk,1000,false)==0&&nativeCppError.empty();
    }
    Event(voiceReady?"voice-construction-probe-passed":"voice-construction-probe-unavailable");
    const auto stickerRoot=std::filesystem::u8path(config.value("stickerRoot",""));
    stickerReady=config.value("stickerProfile","")=="gif-manager-v1"&&stickerRoot.is_absolute()&&StickerProfileMatches();
    httplib::Server server;server.set_payload_max_length(65536);
    auto authorized=[token](const httplib::Request& req,httplib::Response& res){
        const std::string expected="Bearer "+token,supplied=req.get_header_value("Authorization");
        unsigned difference=static_cast<unsigned>(expected.size()^supplied.size());
        for(size_t i=0;i<expected.size();++i)difference|=expected[i]^(i<supplied.size()?supplied[i]:0);
        if(difference){res.status=401;res.set_content("{\"error\":\"unauthorized\"}","application/json");return false;}return true;
    };
    server.Get("/WeChatAgent/health",[&](const httplib::Request& req,httplib::Response& res){
        if(!authorized(req,res))return;
        res.set_content(json({{"backend","wechat-hook"},{"integration","WeChatAgent-1"},{"profile","4.1.15.13-media-mentions-v2"},{"startupState",probeReady.load()&&!faulted.load()?"ready":"failed"},{"version",Version()},
          {"pid",GetCurrentProcessId()},{"databaseAccounts",Accounts()},{"nativeTextSend",probeReady.load()&&!faulted.load()},
          {"nativeImageSend",probeReady.load()&&!faulted.load()},{"nativeMentionSend",probeReady.load()&&!faulted.load()},
          {"nativeQuoteSend",false},{"nativeStickerSend",stickerReady.load()&&!faulted.load()},{"stickerProfile",stickerReady.load()?"gif-manager-v1":""},{"nativeVoiceSend",voiceReady.load()&&!faulted.load()},{"voiceProfile","recording-factory-v1"},{"loaderInit","worker-path-v1"},{"phase",phase.load()},{"faulted",faulted.load()},
          {"diagnostics",{{"messageTableRva",actualMessageTable.load()},{"receiverLength",receiverLength.load()},
            {"receiverCapacity",receiverCapacity.load()},{"contentLength",contentLength.load()},{"contentCapacity",contentCapacity.load()}}}}).dump(),"application/json");
    });
    server.Post("/WeChatAgent/probe",[&](const httplib::Request& req,httplib::Response& res){
        if(!authorized(req,res))return;std::lock_guard<std::mutex> lock(sendMutex);
        if(faulted){res.status=409;res.set_content("{\"error\":\"native fault; no retry\"}","application/json");return;}
        try{DWORD code=GuardProbe();if(code){faulted=true;throw std::runtime_error("native construction fault "+std::to_string(code));}
            if(!nativeCppError.empty())throw std::runtime_error(nativeCppError);
            probeReady=true;Event("construction-probe-passed");res.set_content("{\"ok\":true,\"sendCalls\":0,\"desktopInputs\":0}","application/json");
        }catch(const std::exception& e){faulted=true;probeReady=false;res.status=503;res.set_content(json({{"error",e.what()},{"phase",phase.load()}}).dump(),"application/json");}
    });
    server.Post("/SendTextMsg",[&](const httplib::Request& req,httplib::Response& res){
        if(!authorized(req,res))return;std::lock_guard<std::mutex> lock(sendMutex);
        const auto accounts=Accounts();
        if(!probeReady||faulted||accounts.size()!=1||!accounts.count(req.get_header_value("X-WeChatAgent-Account"))){
            res.status=409;res.set_content("{\"ret\":1,\"error\":\"native backend or account not ready\"}","application/json");return;}
        try{
            const auto body=json::parse(req.body);const auto target=body.value("wxidorgid",""),text=body.value("msg","");
            if(target.empty()||target.size()>256||text.empty()||text.size()>16000||target.find('\0')!=std::string::npos||text.find('\0')!=std::string::npos){
                res.status=400;res.set_content("{\"ret\":1,\"error\":\"invalid text request\"}","application/json");return;}
            const DWORD code=GuardSubmit(&target,&text);
            if(code){faulted=true;Event("native-send-fault");throw std::runtime_error("native submission uncertain "+std::to_string(code));}
            if(!nativeCppError.empty())throw std::runtime_error(nativeCppError);
            Event("native-send-accepted");res.set_content("{\"ret\":0,\"retmsg\":\"accepted\"}","application/json");
        }catch(const std::exception& e){res.status=503;res.set_content(json({{"ret",1},{"error",e.what()},{"phase",phase.load()}}).dump(),"application/json");}
    });
    auto readyFor=[&](const httplib::Request& req,httplib::Response& res){
        const auto accounts=Accounts();
        if(!probeReady||faulted||accounts.size()!=1||!accounts.count(req.get_header_value("X-WeChatAgent-Account"))){
            res.status=409;res.set_content("{\"ret\":1,\"error\":\"native backend or account not ready\"}","application/json");return false;
        }return true;
    };
    const auto stickerRequest=[&](const httplib::Request& req,httplib::Response& res,bool send){
        if(!authorized(req,res))return;
        std::lock_guard<std::mutex> lock(sendMutex);
        if(!readyFor(req,res))return;
        const auto reply=[&](int status,const char* message){res.status=status;res.set_content(json({{"ret",status==200?0:1},{"retmsg",message}}).dump(),"application/json");};
        if(!stickerReady){reply(409,"sticker profile unavailable");return;}
        std::string target;std::wstring file;
        try{
            const auto body=json::parse(req.body);target=body.value("wxidorgid","");
            if(!ValidTarget(target))throw std::runtime_error("invalid sticker target");
            file=CheckedSticker(body.value("path",""),stickerRoot,body.at("sticker"));
        }catch(...){reply(400,"invalid sticker GIF");return;}
        const auto result=ScheduleSticker(target,file,req.get_header_value("X-WeChatAgent-Account"),send);
        if(result==StickerOutcome::accepted){
            Event(send?"native-sticker-send-accepted":"native-sticker-construction-passed");
            reply(200,send?"accepted":"constructed without sending");
        }else if(result==StickerOutcome::rejected){reply(400,"invalid sticker GIF");}
        else if(result==StickerOutcome::unavailable){reply(409,"sticker context unavailable");}
        else{reply(503,"sticker submission uncertain");}
    };
    server.Post("/WeChatAgent/sticker-probe",[&](const httplib::Request& req,httplib::Response& res){stickerRequest(req,res,false);});
    server.Post("/SendStickerMsg",[&](const httplib::Request& req,httplib::Response& res){stickerRequest(req,res,true);});
    server.Post("/SendImgMsg",[&](const httplib::Request& req,httplib::Response& res){
        if(!authorized(req,res))return;std::lock_guard<std::mutex> lock(sendMutex);if(!readyFor(req,res))return;
        std::string target,file;uint64_t bytes=0;
        try{
            const auto body=json::parse(req.body);target=body.value("wxidorgid","");if(!ValidTarget(target))throw std::runtime_error("invalid target");
            const auto image=CheckedImage(body.value("path",""),std::filesystem::u8path(config.value("imageRoot","")));file=image.u8string();bytes=std::filesystem::file_size(image);
        }catch(const std::exception& e){res.status=400;res.set_content(json({{"ret",1},{"error",e.what()}}).dump(),"application/json");return;}
        const DWORD code=GuardImage(&target,&file,bytes);
        if(code||!nativeCppError.empty()){
            faulted=true;Event("native-image-send-uncertain");res.status=503;res.set_content("{\"ret\":1,\"error\":\"native image submission uncertain; do not retry\"}","application/json");return;
        }
        Event("native-image-send-accepted");res.set_content("{\"ret\":0,\"retmsg\":\"accepted\"}","application/json");
    });
    server.Post("/SendVoiceMsg",[&](const httplib::Request& req,httplib::Response& res){
        if(!authorized(req,res))return;std::lock_guard<std::mutex> lock(sendMutex);if(!readyFor(req,res))return;
        if(!voiceReady){res.status=409;res.set_content("{\"ret\":1,\"error\":\"voice profile unavailable\"}","application/json");return;}
        std::string target,silk;uint32_t duration=0;
        try{
            const auto body=json::parse(req.body);target=body.value("wxidorgid","");
            const auto ms=body.at("duration_ms").get<int64_t>();
            if(!ValidTarget(target)||ms<20||ms>60000)throw std::runtime_error("invalid voice target or duration");
            duration=static_cast<uint32_t>(ms);
            silk=ReadSilk(body.value("path",""),std::filesystem::u8path(config.value("voiceRoot","")),body.at("size").get<uint64_t>());
        }catch(const std::exception& e){res.status=400;res.set_content(json({{"ret",1},{"error",e.what()}}).dump(),"application/json");return;}
        if(GuardVoice(&target,&silk,duration,true)||!nativeCppError.empty()){
            voiceReady=false;Event("native-voice-submission-uncertain");res.status=503;res.set_content("{\"ret\":1,\"error\":\"voice submission uncertain\"}","application/json");return;
        }
        Event("native-voice-send-accepted");res.set_content("{\"ret\":0,\"retmsg\":\"accepted\"}","application/json");
    });
    server.Post("/SendTextAtMsg",[&](const httplib::Request& req,httplib::Response& res){
        if(!authorized(req,res))return;std::lock_guard<std::mutex> lock(sendMutex);if(!readyFor(req,res))return;
        std::string target,text,ids;
        try{
            const auto body=json::parse(req.body);target=body.value("wxidorgid","");text=body.value("msg","");
            if(!ValidTarget(target)||target.size()<10||target.substr(target.size()-9)!="@chatroom"||text.empty()||text.size()>16000||text.find('\0')!=std::string::npos)throw std::runtime_error("invalid group mention request");
            ids=MentionList(body.at("atUserIds"));
        }catch(const std::exception& e){res.status=400;res.set_content(json({{"ret",1},{"error",e.what()}}).dump(),"application/json");return;}
        const DWORD code=GuardMention(&target,&text,&ids);
        if(code||!nativeCppError.empty()){
            faulted=true;Event("native-mention-send-uncertain");res.status=503;res.set_content("{\"ret\":1,\"error\":\"native mention submission uncertain; do not retry\"}","application/json");return;
        }
        Event("native-mention-send-accepted");res.set_content("{\"ret\":0,\"retmsg\":\"accepted\"}","application/json");
    });
    const auto url=config.value("baseUrl","");
    std::smatch match;
    const int port=std::regex_match(url,match,std::regex(R"(http://127\.0\.0\.1:([0-9]{1,5}))"))?std::stoi(match[1]):0;
    if(port<1024||port>65535){Event("invalid-loopback-port");return 4;}
    Event("loopback-backend-starting");server.listen("127.0.0.1",port);Event("loopback-backend-stopped");return 0;
}
}
BOOL WINAPI DllMain(HINSTANCE instance,DWORD reason,void*){
    if(reason==DLL_PROCESS_ATTACH){
        HANDLE thread=CreateThread(nullptr,0,Run,instance,0,nullptr);if(!thread)return FALSE;CloseHandle(thread);
    }return TRUE;
}

