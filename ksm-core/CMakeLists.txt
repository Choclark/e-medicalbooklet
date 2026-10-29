cmake_minimum_required(VERSION 3.15)

project(KsmCore VERSION 1.0.0 LANGUAGES CXX)

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)

add_executable(ksm_core
    main.cpp
    CShamir/GF256.cpp
    CShamir/ShamirSecretSharing.cpp
    CCrypto/AesGcmCipher.cpp
    CCrypto/Sha256.cpp
    CSchemaSplit/SchemaSplitter.cpp
    CKsmNode/KsmShareStorage.cpp
    CKsmNode/KsmNode.cpp
    CDkg/KsmCluster.cpp
    CProtocol/KsmDynamicJoinProtocol.cpp
)

target_link_libraries(ksm_core PRIVATE bcrypt ws2_32)

target_include_directories(ksm_core PRIVATE
    ${CMAKE_CURRENT_SOURCE_DIR}
    ${CMAKE_CURRENT_SOURCE_DIR}/CShamir
    ${CMAKE_CURRENT_SOURCE_DIR}/CCrypto
    ${CMAKE_CURRENT_SOURCE_DIR}/CSchemaSplit
    ${CMAKE_CURRENT_SOURCE_DIR}/CKsmNode
    ${CMAKE_CURRENT_SOURCE_DIR}/CDkg
    ${CMAKE_CURRENT_SOURCE_DIR}/CProtocol
    ${CMAKE_CURRENT_SOURCE_DIR}/CWire
)
