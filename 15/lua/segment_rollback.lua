local tx_key = KEYS[1]
local base_key = KEYS[2]
local tx_id = ARGV[1]

local detail = redis.call('HGET', tx_key, tx_id)
if not detail then
    return -1
end

local total = 0
for entry in string.gmatch(detail, '([^,]+)') do
    local seg_idx, seg_qty = entry:match('(%d+):(%d+)')
    if seg_idx and seg_qty then
        local seg_key = base_key .. ':seg:' .. seg_idx
        redis.call('INCRBY', seg_key, tonumber(seg_qty))
        total = total + tonumber(seg_qty)
    end
end

redis.call('HDEL', tx_key, tx_id)

return total
