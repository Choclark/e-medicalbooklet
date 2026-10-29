cmake_minimum_required(VERSION 3.15)

project(BlockchainCore VERSION 1.0.0 LANGUAGES CXX)

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)

add_executable(blockchain_core
    main.cpp
    CCrypto/Sha256.cpp
    CCrypto/CryptoSigner.cpp
    CConfig/CConfig.cpp
    CTransaction/CTransaction.cpp
    CTransaction/COnChainTxRecord.cpp
    CTransaction/CSchema.cpp
    CTransaction/CSchemaRegistry.cpp
    CConsensus/CConsensusRules.cpp
    CConsensus/CPbftEngine.cpp
    CBlock/Cblock.cpp
    CChain/Cchain.cpp
    CStorage/CBlockStore.cpp
    CStorage/CArchiveManager.cpp
    CRecordStorage/CSqliteRecordDb.cpp
    CRecordStorage/CCouchDbRecordDb.cpp
    CRecordStorage/CRecordStorageManager.cpp
    CAccessControl/AccessManager.cpp
    CMerkle/CMerkleTree.cpp
    CMerkle/CMerkleStore.cpp
    CCrud/CrudManager.cpp
    CChannel/CChannelManager.cpp
    ../ksm-core/CShamir/GF256.cpp
    ../ksm-core/CShamir/ShamirSecretSharing.cpp
    ../ksm-core/CCrypto/AesGcmCipher.cpp
    ../ksm-core/CCrypto/Sha256.cpp
    ../ksm-core/CSchemaSplit/SchemaSplitter.cpp
    ../ksm-core/CKsmNode/KsmShareStorage.cpp
    ../ksm-core/CKsmNode/KsmNode.cpp
    ../ksm-core/CDkg/KsmCluster.cpp
    ../ksm-core/CProtocol/KsmDynamicJoinProtocol.cpp
)

target_link_libraries(blockchain_core PRIVATE
    bcrypt
    ws2_32
)

target_include_directories(blockchain_core PRIVATE
    ${CMAKE_CURRENT_SOURCE_DIR}
    ${CMAKE_CURRENT_SOURCE_DIR}/CCommon
    ${CMAKE_CURRENT_SOURCE_DIR}/CCrypto
    ${CMAKE_CURRENT_SOURCE_DIR}/CConfig
    ${CMAKE_CURRENT_SOURCE_DIR}/CTransaction
    ${CMAKE_CURRENT_SOURCE_DIR}/CConsensus
    ${CMAKE_CURRENT_SOURCE_DIR}/CBlock
    ${CMAKE_CURRENT_SOURCE_DIR}/CChain
    ${CMAKE_CURRENT_SOURCE_DIR}/CStorage
    ${CMAKE_CURRENT_SOURCE_DIR}/CRecordStorage
    ${CMAKE_CURRENT_SOURCE_DIR}/CAccessControl
    ${CMAKE_CURRENT_SOURCE_DIR}/CMerkle
    ${CMAKE_CURRENT_SOURCE_DIR}/CCrud
    ${CMAKE_CURRENT_SOURCE_DIR}/CChannel
    ${CMAKE_CURRENT_SOURCE_DIR}/../ksm-core
    ${CMAKE_CURRENT_SOURCE_DIR}/../ksm-core/CShamir
    ${CMAKE_CURRENT_SOURCE_DIR}/../ksm-core/CCrypto
    ${CMAKE_CURRENT_SOURCE_DIR}/../ksm-core/CSchemaSplit
    ${CMAKE_CURRENT_SOURCE_DIR}/../ksm-core/CKsmNode
    ${CMAKE_CURRENT_SOURCE_DIR}/../ksm-core/CDkg
    ${CMAKE_CURRENT_SOURCE_DIR}/../ksm-core/CProtocol
    ${CMAKE_CURRENT_SOURCE_DIR}/../ksm-core/CWire
)

add_executable(ksm_core
    ../ksm-core/main.cpp
    ../ksm-core/CShamir/GF256.cpp
    ../ksm-core/CShamir/ShamirSecretSharing.cpp
    ../ksm-core/CCrypto/AesGcmCipher.cpp
    ../ksm-core/CCrypto/Sha256.cpp
    ../ksm-core/CSchemaSplit/SchemaSplitter.cpp
    ../ksm-core/CKsmNode/KsmShareStorage.cpp
    ../ksm-core/CKsmNode/KsmNode.cpp
    ../ksm-core/CDkg/KsmCluster.cpp
    ../ksm-core/CProtocol/KsmDynamicJoinProtocol.cpp
)

target_link_libraries(ksm_core PRIVATE
    bcrypt
    ws2_32
)

target_include_directories(ksm_core PRIVATE
    ${CMAKE_CURRENT_SOURCE_DIR}/../ksm-core
    ${CMAKE_CURRENT_SOURCE_DIR}/../ksm-core/CShamir
    ${CMAKE_CURRENT_SOURCE_DIR}/../ksm-core/CCrypto
    ${CMAKE_CURRENT_SOURCE_DIR}/../ksm-core/CSchemaSplit
    ${CMAKE_CURRENT_SOURCE_DIR}/../ksm-core/CKsmNode
    ${CMAKE_CURRENT_SOURCE_DIR}/../ksm-core/CDkg
    ${CMAKE_CURRENT_SOURCE_DIR}/../ksm-core/CProtocol
    ${CMAKE_CURRENT_SOURCE_DIR}/../ksm-core/CWire
)
