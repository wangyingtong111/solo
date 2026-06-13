local tx_key = KEYS[1]
local base_key = KEYS[2]
local tx_id = ARGV[1]
local segment_count = tonumber(ARGV[2])

local quantity = redis.call('HGET', tx_key, tx_id)
if not quantity then
    return -1
end

quantity = tonumber(quantity)

local per_seg = math.ceil(quantity / segment_count)
local leftover = quantity

for i = 0, segment_count - 1 do
    if leftover <= 0 then break end
    local add_qty = math.min(per_seg, leftover)
    local seg_key = base_key .. ':seg:' .. i
    redis.call('INCRBY', seg_key, add_qty)
    leftover = leftover - add_qty
end

redis.call('HDEL', tx_key, tx_id)

return quantity
