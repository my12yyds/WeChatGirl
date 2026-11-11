#pragma once
#include <cstddef>
#include <cstdint>

// Verified for the 4.1.15.13 x64 Weixin.dll only. Do not reuse across versions.
// Runtime checks also verify SizeOfImage, send entry bytes and sender vtable.
namespace WeChatAgentText41513 {
constexpr uintptr_t SendRva=0x19d0bc0,TextCtorRva=0x766680,FactoryRva=0xf910;
constexpr uintptr_t OwnerTable=0x8e534f8,MessageTable=0x8e53588,SenderTable=0x9112308;
constexpr uintptr_t ImageCtorRva=0x1a81f70,ImageOwnerTable=0x90dace8,ImageMessageTable=0x90dad78;
constexpr uintptr_t AllocateRva=0x74ab89c,FreeRva=0x74ab8e0;
// The recording caller at 0x6bdfbc0 calls this factory and stamps type 34
// at +0x118. The constructor copies SILK at +0x758 and duration at +0x778.
constexpr uintptr_t VoiceFactoryRva=0x6be0020,VoiceOwnerTable=0x9af8fe8,VoiceMessageTable=0x9af9078;
constexpr size_t ImageSize=202039296;
}
